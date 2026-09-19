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
    ("Information meeting for Parents - Year 1 and 2", "whole-school", None),
    ("Eucharist Year 5 and Year 6 - St Paul's Church", "whole-school", None),
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
]


@pytest.mark.parametrize("raw_url,expected", SAFE_URL_CASES)
def test_safe_url(raw_url, expected):
    assert build_ics._safe_url(raw_url) == expected


# --------------------------------------------------------------------------
# build_event() - school-API-sourced events: per-calendar title prefixing,
# and the whole-school description-override mechanism (see
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


def test_load_whole_school_overrides_reads_json(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    path.write_text('{"857": "Updated description"}')
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    assert build_ics.load_whole_school_overrides() == {"857": "Updated description"}


def test_prune_whole_school_overrides_drops_ids_missing_from_feed():
    overrides = {"857": "kept", "999": "school deleted this event"}
    raw_events = [{"id": 857}, {"id": 858}]
    assert build_ics.prune_whole_school_overrides(overrides, raw_events) == {"857": "kept"}


def test_prune_whole_school_overrides_keeps_all_when_feed_has_them():
    overrides = {"857": "a", "858": "b"}
    assert build_ics.prune_whole_school_overrides(overrides, [{"id": 857}, {"id": 858}]) == overrides


def test_prune_whole_school_overrides_empty_feed_prunes_nothing():
    # A school-side outage returning [] must not wipe every saved override.
    overrides = {"857": "a"}
    assert build_ics.prune_whole_school_overrides(overrides, []) == overrides


def test_save_whole_school_overrides_matches_tool_format(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", path)
    build_ics.save_whole_school_overrides({"857": "Parking – use the side gate"})
    assert path.read_text() == '{\n  "857": "Parking – use the side gate"\n}\n'


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
