"""Tests for the trickiest logic in scripts/build_ics.py: title-based
classification, closure-date detection, the recurrence/DST fix, multi-day
date math, and URL sanitization. Not a full suite - just enough to catch a
regression in the parts of this script that are genuinely easy to get
subtly wrong (this session found and fixed a real DST bug in exactly the
recurrence code covered here).

Run with: pytest tests/ (from the repo root, with requirements-dev.txt
installed in addition to requirements.txt).
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from icalendar import Calendar

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_ics  # noqa: E402


# --------------------------------------------------------------------------
# classify_event()
# --------------------------------------------------------------------------

CLASSIFY_CASES = [
    # (title, expected_bucket, expected_class_codes_or_None)
    ("INSET DAY - school closed to pupils", "whole-school", None),
    ("Back to School", "whole-school", None),
    ("Half Term Break", "whole-school", None),
    ("Whole School Church Service (not Reception Children)", "whole-school", None),
    ("Information meeting for Parents - KS2", "whole-school", None),
    # Several *named* years go to those years' classes only (not whole-school,
    # which is for KS1/KS2/"whole school" or no year at all).
    ("Information meeting for Parents - Year 1 and 2", "classes", {"1MS", "1T", "2LY", "2S"}),
    ("Eucharist Year 5 and Year 6 - St Paul's Church", "classes", {"5L", "5HP", "6BT", "6R"}),
    ("Eucharist Service Year 5 and Year 6 - in school", "classes", {"5L", "5HP", "6BT", "6R"}),
    ("5HP and 6R Museum Trip", "classes", {"5HP", "6R"}),
    ("5HP and Year 6 Museum Trip", "classes", {"5HP", "6BT", "6R"}),
    # A range names only its ends, so it can't be fanned out - whole-school.
    ("Reception to Year 6 Sports Day", "whole-school", None),
    ("Year 1 - Year 6 Sports Day", "whole-school", None),
    ("Year 3-6 Swimming Gala", "whole-school", None),
    ("R/KS1 Dress rehearsal to KS2", "whole-school", None),
    ("5HP Collective Worship to parents", "classes", {"5HP"}),
    ("4W Collective Worship to parents", "classes", {"4W"}),
    ("Year 5 to Celtic Harmony", "classes", {"5L", "5HP"}),
    ("Year 3 to Celtic Harmony", "classes", {"3B", "3D"}),
    ("Reception Group 1 Start", "classes", {"RR", "RGP"}),
    # Unrecognised class-code-shaped tokens fall back to both classes in
    # that year group (the label-churn case: a new teacher's initials).
    ("6L Collective Worship to parents", "classes", {"6BT", "6R"}),
    ("5M Collective Worship", "classes", {"5L", "5HP"}),
]


@pytest.mark.parametrize("title,expected_bucket,expected_codes", CLASSIFY_CASES)
def test_classify_event(title, expected_bucket, expected_codes):
    bucket, codes = build_ics.classify_event(title)
    assert bucket == expected_bucket
    if expected_codes is not None:
        assert codes == expected_codes


# --------------------------------------------------------------------------
# collect_closure_dates()
# --------------------------------------------------------------------------


def _all_day_event(title, start_iso, end_iso=None):
    raw = {"title": title, "allDay": True, "start": start_iso}
    if end_iso:
        raw["end"] = end_iso
    return raw


def test_collect_closure_dates_single_day_inset():
    dates = build_ics.collect_closure_dates([_all_day_event("INSET DAY - school closed to pupils", "2026-09-02")])
    assert dates == {date(2026, 9, 2)}


def test_collect_closure_dates_multi_day_half_term():
    # DTEND-style exclusive end: 27th through 30th inclusive.
    dates = build_ics.collect_closure_dates([_all_day_event("Half Term Break", "2026-10-27", "2026-10-31")])
    assert dates == {date(2026, 10, 27), date(2026, 10, 28), date(2026, 10, 29), date(2026, 10, 30)}


def test_collect_closure_dates_ignores_non_closure_events():
    dates = build_ics.collect_closure_dates(
        [_all_day_event("Back to School", "2026-09-03"), _all_day_event("MacMillan Coffee Morning", "2026-09-25")]
    )
    assert dates == set()


def test_collect_closure_dates_matches_holiday_keyword():
    dates = build_ics.collect_closure_dates([_all_day_event("Christmas Holiday", "2026-12-21", "2026-12-22")])
    assert dates == {date(2026, 12, 21)}


# --------------------------------------------------------------------------
# _safe_url() - see the stored-XSS fix: an event's url is rendered as an
# <a href> on the public preview page, so only http(s) may ever pass.
# --------------------------------------------------------------------------

SAFE_URL_CASES = [
    ("javascript:alert(1)", None),
    ("data:text/html,<script>alert(1)</script>", None),
    (None, None),
    ("", None),
    ("http://example.com", "http://example.com"),
    ("https://example.com/page?x=1", "https://example.com/page?x=1"),
    # A control character makes icalendar raise while serialising, which
    # would fail the whole build - so the URL is dropped instead.
    ("http://example.com/a\r\nX-EVIL:1", None),
    ("http://example.com/a\nb", None),
    ("http://example.com/\x00", None),
]


@pytest.mark.parametrize("raw_url,expected", SAFE_URL_CASES)
def test_safe_url(raw_url, expected):
    assert build_ics._safe_url(raw_url) == expected


# --------------------------------------------------------------------------
# build_event() - school-API-sourced events: per-calendar title prefixing,
# and the whole-school description/location override mechanism (see
# load_whole_school_overrides() / WHOLE_SCHOOL_OVERRIDES_PATH).
# --------------------------------------------------------------------------


def test_build_event_whole_school_has_no_prefix():
    raw = {"id": 1, "title": "INSET DAY", "allDay": True, "start": "2026-09-02"}
    event = build_ics.build_event(raw)
    assert str(event["summary"]) == "INSET DAY"


def test_build_event_class_prefixes_title_with_code():
    raw = {"id": 2, "title": "PE Kit", "allDay": True, "start": "2026-09-16"}
    event = build_ics.build_event(raw, code="rr")
    assert str(event["summary"]) == "RR: PE Kit"


def test_build_event_keeps_school_description_with_no_override():
    raw = {"id": 3, "title": "Some Event", "allDay": True, "start": "2026-09-23", "desc": "Original text"}
    event = build_ics.build_event(raw)
    assert str(event["description"]) == "Original text"


def test_build_event_turns_school_html_description_into_plain_text():
    raw = {
        "id": 10,
        "title": "Last Day of Autumn Term",
        "allDay": True,
        "start": "2026-12-18",
        "desc": "<p>Reception     1:15pm<br />Year 1 and 3 1:20pm<br />Year 5 and 6 1:30pm</p>",
    }
    event = build_ics.build_event(raw)
    assert str(event["description"]) == "Reception 1:15pm\nYear 1 and 3 1:20pm\nYear 5 and 6 1:30pm"


@pytest.mark.parametrize(
    "desc, expected",
    [
        ("<p>R/KS1 AM</p><p>KS2 PM</p>", "R/KS1 AM\nKS2 PM"),
        ("<p>Tom &amp; Jerry&nbsp;night</p>", "Tom & Jerry night"),
        ("<p>Use &lt;b&gt; literally</p>", "Use <b> literally"),
        ('<p>See <a href="https://example.com">the site</a></p>', "See the site"),
        ("Plain text\r\n\r\nstays", "Plain text\nstays"),
        ("<p></p>", ""),
        (None, ""),
    ],
)
def test_clean_description(desc, expected):
    assert build_ics._clean_description(desc) == expected


def test_build_event_override_replaces_school_description():
    raw = {"id": 4, "title": "Nasal Flu Spray", "allDay": True, "start": "2026-09-23", "desc": "<p>Whole School</p>"}
    event = build_ics.build_event(raw, description_override="Updated by the office")
    assert str(event["description"]) == "Updated by the office"


def test_build_event_empty_override_clears_description():
    raw = {"id": 5, "title": "Some Event", "allDay": True, "start": "2026-09-23", "desc": "Original text"}
    event = build_ics.build_event(raw, description_override="")
    assert "description" not in event


def test_load_whole_school_overrides_missing_file_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", tmp_path / "missing.json")
    assert build_ics.load_whole_school_overrides() == {}


def test_build_event_location_override_sets_location():
    raw = {"id": 6, "title": "INSET DAY", "allDay": True, "start": "2026-09-02"}
    event = build_ics.build_event(raw, location_override="School hall")
    assert str(event["location"]) == "School hall"


def test_build_event_without_location_override_has_no_location():
    raw = {"id": 7, "title": "INSET DAY", "allDay": True, "start": "2026-09-02"}
    assert "location" not in build_ics.build_event(raw)


def test_build_event_location_and_description_overrides_are_independent():
    raw = {"id": 8, "title": "Some Event", "allDay": True, "start": "2026-09-23", "desc": "Original text"}
    event = build_ics.build_event(raw, location_override="Main playground")
    assert str(event["description"]) == "Original text"  # description override not set -> school's text stays
    assert str(event["location"]) == "Main playground"


def test_load_whole_school_overrides_reads_json(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    path.write_text('{"857": {"description": "Updated description", "location": "School hall"}}')
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    assert build_ics.load_whole_school_overrides() == {
        "857": {"description": "Updated description", "location": "School hall"}
    }


def test_load_whole_school_overrides_reads_legacy_string_entries(tmp_path, monkeypatch):
    # Before locations existed an entry was just "<id>": "<description>".
    path = tmp_path / "overrides.json"
    path.write_text('{"857": "Updated description", "858": {"location": "Church"}}')
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    assert build_ics.load_whole_school_overrides() == {
        "857": {"description": "Updated description"},
        "858": {"location": "Church"},
    }


def test_load_whole_school_overrides_ignores_unrecognised_entries(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    path.write_text('{"857": {"colour": "red", "location": 5}, "858": 12, "859": {"location": "Hall"}}')
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    assert build_ics.load_whole_school_overrides() == {"859": {"location": "Hall"}}


def test_prune_whole_school_overrides_drops_ids_missing_from_feed():
    overrides = {"857": {"description": "kept"}, "999": {"location": "school deleted this event"}}
    raw_events = [{"id": 857}, {"id": 858}]
    assert build_ics.prune_whole_school_overrides(overrides, raw_events) == {"857": {"description": "kept"}}


def test_prune_whole_school_overrides_keeps_all_when_feed_has_them():
    overrides = {"857": {"description": "a"}, "858": {"location": "b"}}
    assert build_ics.prune_whole_school_overrides(overrides, [{"id": 857}, {"id": 858}]) == overrides


def test_prune_whole_school_overrides_empty_feed_prunes_nothing():
    # A school-side outage returning [] must not wipe every saved override.
    overrides = {"857": {"description": "a"}}
    assert build_ics.prune_whole_school_overrides(overrides, []) == overrides


def test_save_whole_school_overrides_matches_tool_format(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    build_ics.save_whole_school_overrides({"857": {"description": "Parking – use the side gate", "location": "Car park"}})
    assert path.read_text() == (
        '{\n  "857": {\n    "description": "Parking – use the side gate",\n    "location": "Car park"\n  }\n}\n'
    )


def test_build_event_class_override_keeps_code_prefix():
    raw = {"id": 9, "title": "Group 1 Start", "allDay": True, "start": "2026-09-08", "desc": "Original text"}
    event = build_ics.build_event(raw, code="rr", description_override="Bring a water bottle", location_override="Hall")
    assert str(event["summary"]) == "RR: Group 1 Start"
    assert str(event["description"]) == "Bring a water bottle"
    assert str(event["location"]) == "Hall"


def _build_with_overrides(tmp_path, monkeypatch, raw_events, overrides):
    """Runs main() against a fake school feed and the given overrides,
    returning {calendar file name: parsed Calendar} for what it wrote."""
    path = tmp_path / "overrides.json"
    path.write_text(json.dumps(overrides))
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    monkeypatch.setattr(build_ics, "CALENDARS_DIR", tmp_path / "calendars")
    monkeypatch.setattr(build_ics, "MANUAL_EVENTS_DIR", tmp_path / "manual")
    monkeypatch.setattr(build_ics, "fetch_events", lambda: raw_events)
    build_ics.main()
    return {f.name: Calendar.from_ical(f.read_bytes()) for f in (tmp_path / "calendars").glob("*.ics")}


def _events_by_uid(cal):
    return {str(e["uid"]): e for e in cal.walk("VEVENT")}


def test_main_applies_overrides_to_class_events(tmp_path, monkeypatch):
    # "Reception ..." names one year group and no class, so it's built into
    # both Reception classes; an override for its school id must reach both.
    raw = {"id": 42, "title": "Reception Group 1 Start", "allDay": True, "start": "2026-09-08", "desc": "School text"}
    overrides = {"42": {"description": "Updated by the class rep", "location": "Reception hall"}}
    cals = _build_with_overrides(tmp_path, monkeypatch, [raw], overrides)

    uid = "stpauls-42@school-calendar-feed"
    for name in ("rr.ics", "rgp.ics"):
        event = _events_by_uid(cals[name])[uid]
        assert str(event["description"]) == "Updated by the class rep"
        assert str(event["location"]) == "Reception hall"
    assert uid not in _events_by_uid(cals["whole-school.ics"])


def test_main_class_event_without_override_keeps_school_text(tmp_path, monkeypatch):
    raw = {"id": 43, "title": "Reception Group 2 Start", "allDay": True, "start": "2026-09-09", "desc": "School text"}
    cals = _build_with_overrides(tmp_path, monkeypatch, [raw], {"999": {"description": "for another event"}})

    event = _events_by_uid(cals["rr.ics"])["stpauls-43@school-calendar-feed"]
    assert str(event["description"]) == "School text"
    assert "location" not in event


# --------------------------------------------------------------------------
# build_manual_event() - multi-day date math + the recurrence/DST fix
# --------------------------------------------------------------------------


def test_multi_day_all_day_event_dtend_is_exclusive():
    raw = {"id": "t1", "title": "Residential", "date": "2026-11-09", "end_date": "2026-11-11"}
    events = build_ics.build_manual_event(raw, "5hp", set())
    assert len(events) == 1  # no exceptions -> just the base event, no moved one-offs
    assert events[0]["dtstart"].dt == date(2026, 11, 9)
    # DTEND is exclusive, so a 3-day (9th-11th inclusive) event ends the 12th.
    assert events[0]["dtend"].dt == date(2026, 11, 12)


def test_manual_event_prefixes_title_with_calendar_code():
    raw = {"id": "m1", "title": "PE Kit", "date": "2026-09-16"}
    events = build_ics.build_manual_event(raw, "rr", set())
    assert str(events[0]["summary"]) == "RR: PE Kit"


def test_manual_event_fosps_prefix_is_uppercased():
    raw = {"id": "m2", "title": "AGM", "date": "2026-10-05"}
    events = build_ics.build_manual_event(raw, "fosps", set())
    assert str(events[0]["summary"]) == "FOSPS: AGM"


def test_manual_event_location_is_published():
    raw = {"id": "m3", "title": "Bake sale", "date": "2026-10-09", "location": "School hall, St Paul's"}
    events = build_ics.build_manual_event(raw, "fosps", set())
    assert str(events[0]["location"]) == "School hall, St Paul's"
    ical_bytes = build_ics.make_calendar("test", events).to_ical()
    assert b"LOCATION:School hall\\, St Paul's" in ical_bytes  # comma escaped per RFC 5545


def test_manual_event_without_location_has_no_location():
    raw = {"id": "m4", "title": "PE Kit", "date": "2026-09-16", "location": None}
    assert "location" not in build_ics.build_manual_event(raw, "rr", set())[0]


def test_load_class_manual_events_merges_the_year_groups_shared_file(tmp_path, monkeypatch):
    monkeypatch.setattr(build_ics, "MANUAL_EVENTS_DIR", tmp_path)
    (tmp_path / "1ms.json").write_text('[{"id": "own1", "title": "1MS only", "date": "2026-10-01"}]')
    (tmp_path / "1t.json").write_text('[{"id": "own2", "title": "1T only", "date": "2026-10-02"}]')
    (tmp_path / "year1.json").write_text('[{"id": "shared1", "title": "Trip", "date": "2026-10-03"}]')
    ms = [raw["id"] for raw in build_ics.load_class_manual_events("1ms", "year1")]
    t = [raw["id"] for raw in build_ics.load_class_manual_events("1t", "year1")]
    assert ms == ["own1", "shared1"]
    assert t == ["own2", "shared1"]


def test_load_class_manual_events_tolerates_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(build_ics, "MANUAL_EVENTS_DIR", tmp_path)
    assert build_ics.load_class_manual_events("rr", "reception") == []


def test_shared_year_event_is_built_per_class_with_its_own_prefix():
    raw = {"id": "shared1", "title": "Trip to the farm", "date": "2026-10-03"}
    ms = build_ics.build_manual_event(raw, "1ms", set())[0]
    t = build_ics.build_manual_event(raw, "1t", set())[0]
    assert str(ms["summary"]) == "1MS: Trip to the farm"
    assert str(t["summary"]) == "1T: Trip to the farm"
    # Same id -> same UID in each class's own feed, like a school year-group event.
    assert str(ms["uid"]) == str(t["uid"]) == "manual-shared1@school-calendar-feed"


def test_year_group_keys_do_not_collide_with_class_codes():
    # data/manual_events/<key>.json holds a year's shared events next to the
    # per-class <code>.json files, so the two namespaces must stay disjoint.
    keys = {group["key"].lower() for group in build_ics.YEAR_GROUPS}
    codes = {cls["code"].lower() for group in build_ics.YEAR_GROUPS for cls in group["classes"]}
    assert keys.isdisjoint(codes | {"fosps", "whole-school"})


def test_recurring_event_uses_tzid_not_utc():
    """Regression test for the DST bug fixed this session: a UTC DTSTART
    makes an RRULE repeat at a fixed UTC instant rather than the same local
    time, silently shifting a weekly "9am" event by an hour across a
    British clock change. Timed recurring (and non-recurring) manual events
    must use TZID=Europe/London, never a bare UTC datetime."""
    raw = {
        "id": "t2",
        "title": "Weekly PE",
        "date": "2026-10-06",
        "time": "09:00",
        "end_time": "10:00",
        "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-11-10"},
    }
    events = build_ics.build_manual_event(raw, "5hp", set())
    ical_bytes = build_ics.make_calendar("test", events).to_ical()

    assert b"DTSTART;TZID=Europe/London" in ical_bytes
    assert b"DTSTART:2026" not in ical_bytes  # would indicate a bare-UTC regression
    assert b"BEGIN:VTIMEZONE" in ical_bytes
    assert b"RRULE:FREQ=WEEKLY" in ical_bytes


def test_recurring_event_excludes_closure_dates_via_exdate():
    closure_dates = {date(2026, 10, 27)}  # half term Tuesday
    raw = {
        "id": "t3",
        "title": "Weekly PE",
        "date": "2026-10-06",
        "time": "09:00",
        "end_time": "10:00",
        "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-11-10"},
    }
    events = build_ics.build_manual_event(raw, "5hp", closure_dates)
    ical_bytes = build_ics.make_calendar("test", events).to_ical()
    assert b"EXDATE;TZID=Europe/London:20261027T090000" in ical_bytes


def test_daily_recurring_event_excludes_weekends():
    raw = {
        "id": "t4",
        "title": "Daily reading",
        "date": "2026-10-19",  # Monday
        "recurrence": {"freq": "DAILY", "interval": 1, "until": "2026-10-20"},  # Mon + Tue only
    }
    events = build_ics.build_manual_event(raw, "5hp", set())
    ical_bytes = build_ics.make_calendar("test", events).to_ical()
    # A 2-day span with no weekend in it shouldn't produce any EXDATE at all.
    assert b"EXDATE" not in ical_bytes


def test_output_parses_as_valid_icalendar():
    """Round-trip sanity check: whatever we generate must actually parse."""
    raw = {
        "id": "t5",
        "title": "Sanity check event",
        "date": "2026-10-06",
        "time": "09:00",
        "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-11-10"},
    }
    events = build_ics.build_manual_event(raw, "5hp", {date(2026, 10, 27)})
    ical_bytes = build_ics.make_calendar("test", events).to_ical()
    parsed = Calendar.from_ical(ical_bytes)
    events = [c for c in parsed.walk() if c.name == "VEVENT"]
    assert len(events) == 1


# --------------------------------------------------------------------------
# build_manual_event() - single-occurrence exceptions (move/cancel one week
# of a recurring event, e.g. PE clashing with a one-off church service)
# --------------------------------------------------------------------------

WEEKLY_PE_BASE = {
    "id": "pe1",
    "title": "PE",
    "date": "2026-10-06",  # Tuesday
    "time": "09:00",
    "end_time": "10:00",
    "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-11-10"},
}


def test_cancelled_exception_adds_exdate_only():
    raw = {**WEEKLY_PE_BASE, "exceptions": [{"date": "2026-10-20", "action": "cancelled"}]}
    events = build_ics.build_manual_event(raw, "5hp", set())
    assert len(events) == 1  # cancelled -> no second event, just an EXDATE
    ical_bytes = build_ics.make_calendar("test", events).to_ical()
    assert b"EXDATE;TZID=Europe/London:20261020T090000" in ical_bytes


def test_moved_exception_excludes_original_and_adds_new_event():
    raw = {
        **WEEKLY_PE_BASE,
        "exceptions": [
            {
                "date": "2026-10-20",
                "action": "moved",
                "new_date": "2026-10-21",
                "new_time": "13:00",
                "new_end_time": "14:00",
            }
        ],
    }
    events = build_ics.build_manual_event(raw, "5hp", set())
    assert len(events) == 2

    base_event, moved_event = events
    base_ical = build_ics.make_calendar("test", [base_event]).to_ical()
    assert b"EXDATE;TZID=Europe/London:20261020T090000" in base_ical

    assert str(moved_event["summary"]) == "5HP: PE"
    assert moved_event["dtstart"].dt == datetime(2026, 10, 21, 13, 0, tzinfo=build_ics.LONDON)
    assert moved_event["dtend"].dt == datetime(2026, 10, 21, 14, 0, tzinfo=build_ics.LONDON)
    # Derived from the parent's id + the ORIGINAL date - distinct from, but
    # stably linked to, the parent series' own UID.
    assert str(moved_event["uid"]) == "manual-pe1-2026-10-20@school-calendar-feed"
    assert str(base_event["uid"]) != str(moved_event["uid"])


def test_moved_exception_inherits_parent_location():
    raw = {
        **WEEKLY_PE_BASE,
        "location": "Sports hall",
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21"}],
    }
    base_event, moved_event = build_ics.build_manual_event(raw, "5hp", set())
    assert str(base_event["location"]) == "Sports hall"
    assert str(moved_event["location"]) == "Sports hall"


def test_moved_exception_inherits_parent_time_if_unspecified():
    raw = {
        **WEEKLY_PE_BASE,
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21"}],
    }
    events = build_ics.build_manual_event(raw, "5hp", set())
    moved_event = events[1]
    # No new_time given - falls back to the parent's own time/end_time.
    assert moved_event["dtstart"].dt == datetime(2026, 10, 21, 9, 0, tzinfo=build_ics.LONDON)
    assert moved_event["dtend"].dt == datetime(2026, 10, 21, 10, 0, tzinfo=build_ics.LONDON)


def test_rebuild_is_idempotent_for_moved_exceptions():
    """Running the build twice must not create a second/duplicate UID for
    the same exception - a routine rebuild or the rep re-saving shouldn't
    multiply moved events."""
    raw = {
        **WEEKLY_PE_BASE,
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21"}],
    }
    first = build_ics.build_manual_event(raw, "5hp", set())
    second = build_ics.build_manual_event(raw, "5hp", set())
    assert str(first[1]["uid"]) == str(second[1]["uid"])


# --------------------------------------------------------------------------
# Exceptions scoped to some classes of a year group's shared event (e.g. only
# RR's class trip clashes with the shared weekly PE)
# --------------------------------------------------------------------------

def _ical_for(raw, code):
    return build_ics.make_calendar("test", build_ics.build_manual_event(raw, code, set())).to_ical()


def test_class_scoped_cancel_only_applies_to_that_class():
    raw = {**WEEKLY_PE_BASE, "exceptions": [{"date": "2026-10-20", "action": "cancelled", "classes": ["rr"]}]}
    assert b"EXDATE;TZID=Europe/London:20261020T090000" in _ical_for(raw, "rr")
    assert b"EXDATE" not in _ical_for(raw, "rgp")


def test_class_scoped_move_only_creates_a_moved_event_for_that_class():
    raw = {
        **WEEKLY_PE_BASE,
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21", "classes": ["rgp"]}],
    }
    assert len(build_ics.build_manual_event(raw, "rgp", set())) == 2
    rr_events = build_ics.build_manual_event(raw, "rr", set())
    assert len(rr_events) == 1
    assert b"EXDATE" not in build_ics.make_calendar("test", rr_events).to_ical()


def test_unscoped_exception_applies_to_every_class():
    raw = {**WEEKLY_PE_BASE, "exceptions": [{"date": "2026-10-20", "action": "cancelled"}]}
    for code in ("rr", "rgp"):
        assert b"EXDATE;TZID=Europe/London:20261020T090000" in _ical_for(raw, code)


def test_empty_classes_list_means_every_class():
    raw = {**WEEKLY_PE_BASE, "exceptions": [{"date": "2026-10-20", "action": "cancelled", "classes": []}]}
    assert b"EXDATE" in _ical_for(raw, "rgp")


def test_class_scope_match_is_case_insensitive():
    raw = {**WEEKLY_PE_BASE, "exceptions": [{"date": "2026-10-20", "action": "cancelled", "classes": ["RR"]}]}
    assert b"EXDATE" in _ical_for(raw, "rr")


def test_class_specific_exception_overrides_unscoped_one_on_same_date():
    # PE is moved for the whole year, but RR's class trip cancels it outright.
    raw = {
        **WEEKLY_PE_BASE,
        "exceptions": [
            {"date": "2026-10-20", "action": "cancelled", "classes": ["rr"]},
            {"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21"},
        ],
    }
    assert len(build_ics.build_manual_event(raw, "rr", set())) == 1  # cancelled, no moved event
    assert len(build_ics.build_manual_event(raw, "rgp", set())) == 2  # the year-wide move


def test_moved_exception_with_new_time_but_no_end_keeps_the_original_length():
    # The parent's 09:00-10:30 end mustn't carry over to a moved 14:00 start
    # (that would end before it begins) - the event's 90 minutes do.
    raw = {
        **WEEKLY_PE_BASE,
        "end_time": "10:30",
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21", "new_time": "14:00"}],
    }
    moved_event = build_ics.build_manual_event(raw, "5hp", set())[1]
    assert moved_event["dtstart"].dt == datetime(2026, 10, 21, 14, 0, tzinfo=build_ics.LONDON)
    assert moved_event["dtend"].dt == datetime(2026, 10, 21, 15, 30, tzinfo=build_ics.LONDON)


def test_moved_exception_with_new_time_and_a_parent_with_no_end_gets_an_hour():
    raw = {
        **{k: v for k, v in WEEKLY_PE_BASE.items() if k != "end_time"},
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21", "new_time": "14:00"}],
    }
    moved_event = build_ics.build_manual_event(raw, "5hp", set())[1]
    assert moved_event["dtend"].dt == datetime(2026, 10, 21, 15, 0, tzinfo=build_ics.LONDON)


def test_moved_exception_can_run_past_midnight_when_the_original_length_does():
    raw = {
        **WEEKLY_PE_BASE,
        "end_time": "11:00",
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21", "new_time": "23:00"}],
    }
    moved_event = build_ics.build_manual_event(raw, "5hp", set())[1]
    assert moved_event["dtend"].dt == datetime(2026, 10, 22, 1, 0, tzinfo=build_ics.LONDON)


def test_moved_exception_keeps_parent_end_when_only_the_date_moves():
    raw = {
        **WEEKLY_PE_BASE,
        "end_time": "10:30",
        "exceptions": [{"date": "2026-10-20", "action": "moved", "new_date": "2026-10-21"}],
    }
    moved_event = build_ics.build_manual_event(raw, "5hp", set())[1]
    assert moved_event["dtstart"].dt == datetime(2026, 10, 21, 9, 0, tzinfo=build_ics.LONDON)
    assert moved_event["dtend"].dt == datetime(2026, 10, 21, 10, 30, tzinfo=build_ics.LONDON)


# --------------------------------------------------------------------------
# One event that can't be built must not stop every calendar publishing.
# --------------------------------------------------------------------------

BAD_MANUAL_EVENTS = {
    "impossible date": {"id": "bad", "title": "Bad", "date": "2026-02-30"},
    "impossible end date": {"id": "bad", "title": "Bad", "date": "2026-10-01", "end_date": "2026-13-01"},
    "impossible repeat-until": {
        "id": "bad",
        "title": "Bad",
        "date": "2026-10-01",
        "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-02-30"},
    },
    "impossible move destination": {
        "id": "bad",
        "title": "Bad",
        "date": "2026-10-01",
        "recurrence": {"freq": "WEEKLY", "interval": 1, "until": "2026-12-01"},
        "exceptions": [{"date": "2026-10-08", "action": "moved", "new_date": "2026-11-31"}],
    },
    "bad time": {"id": "bad", "title": "Bad", "date": "2026-10-01", "time": "25:99"},
    "missing title": {"id": "bad", "date": "2026-10-01"},
    "not an object": "oops",
}
GOOD_MANUAL_EVENT = {"id": "good", "title": "Good", "date": "2026-10-02"}


@pytest.mark.parametrize("bad", BAD_MANUAL_EVENTS.values(), ids=BAD_MANUAL_EVENTS.keys())
def test_build_manual_events_skips_an_event_that_cannot_be_built(bad, capsys):
    events = build_ics.build_manual_events([bad, GOOD_MANUAL_EVENT], "5hp", set())
    assert [str(e["uid"]) for e in events] == [f"manual-good@{build_ics.UID_DOMAIN}"]
    assert "WARNING: skipped a manual event in 5hp.ics" in capsys.readouterr().err


def test_build_manual_events_builds_every_good_event():
    other = {"id": "other", "title": "Other", "date": "2026-10-03"}
    assert len(build_ics.build_manual_events([GOOD_MANUAL_EVENT, other], "5hp", set())) == 2


def test_main_still_publishes_every_calendar_when_a_manual_event_is_bad(tmp_path, monkeypatch, capsys):
    manual = tmp_path / "manual"
    manual.mkdir()
    (manual / "5hp.json").write_text(json.dumps([BAD_MANUAL_EVENTS["impossible date"], GOOD_MANUAL_EVENT]))
    (manual / "year5.json").write_text(json.dumps([BAD_MANUAL_EVENTS["bad time"]]))
    (manual / "fosps.json").write_text(json.dumps([BAD_MANUAL_EVENTS["impossible repeat-until"], GOOD_MANUAL_EVENT]))
    cals = _build_with_overrides(tmp_path, monkeypatch, [], {})

    assert len(cals) == 16  # whole school, 14 classes, FOSPS
    for name in ("5hp.ics", "fosps.ics"):
        assert [str(e["uid"]) for e in cals[name].walk("VEVENT")] == [f"manual-good@{build_ics.UID_DOMAIN}"]
    assert list(cals["5l.ics"].walk("VEVENT")) == []  # year5.json's bad event is skipped there too
    assert capsys.readouterr().err.count("WARNING: skipped a manual event") == 4  # 5hp, 5hp+5l (year5), fosps
