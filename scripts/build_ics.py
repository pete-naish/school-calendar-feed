#!/usr/bin/env python3
"""Fetch St Paul's C of E Primary (Enfield) upcoming events and publish them as
several subscribable .ics feeds, so parents can subscribe to only what's
relevant to them instead of one firehose calendar.

The school's public calendar page (https://www.st-pauls.enfield.sch.uk/calendar/)
is rendered client-side by FullCalendar.js, which itself pulls events from an
unauthenticated JSON API. This script queries that API directly, classifies
each event, and writes out:

- calendars/whole-school.ics   - events affecting the whole school, or
                                  multiple year groups (inset days, holidays,
                                  KS1/KS2-wide events, etc)
- calendars/<class-code>.ics   - one per class (14 total: 2 per year group,
                                  Reception through Year 6). An event tied to
                                  a whole year group (not a specific class)
                                  appears in both of that year's class
                                  calendars. An event tied to one specific
                                  class appears only in that class's calendar.
                                  Also includes hand/AI-entered events from
                                  data/manual_events/<code>.json.
- calendars/fosps.ics          - Friends of St Paul's events. Not published
                                  by the school API at all; sourced from
                                  data/manual_events/fosps.json, maintained by
                                  hand or via the class-rep tool (see tool/).

Classification is title-based (the API gives no structured category), using
the CLASS config below plus a few keyword rules. Unrecognised class-code-shaped
tokens (e.g. a teacher's initials changing) are logged as warnings and fall
back to both classes in that year group, so no one misses an event.
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import date, datetime, time as dt_time, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests
from dateutil.rrule import DAILY, MONTHLY, WEEKLY, rrule
from icalendar import Calendar, Event

API_URL = "https://www.st-pauls.enfield.sch.uk/calendar/api.asp"
SCHOOL_NAME = "St Paul's Enfield"
UID_DOMAIN = "school-calendar-feed"
CALENDARS_DIR = Path(__file__).resolve().parent.parent / "docs" / "calendars"
MANUAL_EVENTS_DIR = Path(__file__).resolve().parent.parent / "data" / "manual_events"

LONDON = ZoneInfo("Europe/London")
UTC = timezone.utc

# The API rejects overly wide date ranges (a ~7 year span 400s), so keep the
# fetch window modest: a bit of recent history plus a year ahead.
FETCH_PAST_DAYS = 30
FETCH_FUTURE_DAYS = 365

REQUEST_HEADERS = {
    "User-Agent": "school-calendar-feed/1.0 (personal family calendar sync)",
}

# --------------------------------------------------------------------------
# Class / year-group configuration.
#
# `code` is a PERMANENT identifier - it's the .ics filename and subscribe URL
# slug (e.g. "5HP" -> calendars/5hp.ics), and once chosen it must never
# change, even if the school later relabels the class. `current_label` is
# what's actually shown to humans (the calendar's display name, and the
# tool/docs UI) - it can be updated freely as the school's labels change,
# with zero impact on anyone's subscription URL.
#
# `aliases` are every label a class has ever used (e.g. Reception's classes
# were "RKJ"/"RKP" and are now "RR"/"RGP") - kept around rather than deleted,
# since the school's own event titles are the only signal we get and old
# labels can resurface in stale copy/pasted event titles.
#
# When the school starts using a class label that isn't listed here (e.g. a
# new teacher), classify_event() below still figures out the *year group*
# from the leading digit/R and fans the event out to both of that year's
# classes, logging a warning so this config can be updated (add the new
# label to `aliases` and update `current_label` - never change `code`).
# --------------------------------------------------------------------------
YEAR_GROUPS = [
    {
        "key": "reception",
        "label": "Reception",
        "number": "R",
        "classes": [
            {"code": "RR", "current_label": "RR", "aliases": ["RR", "RKJ"]},
            {"code": "RGP", "current_label": "RGP", "aliases": ["RGP", "RKP"]},
        ],
    },
    {
        "key": "year1",
        "label": "Year 1",
        "number": "1",
        "classes": [
            {"code": "1MS", "current_label": "1MS", "aliases": ["1MS"]},
            {"code": "1T", "current_label": "1T", "aliases": ["1T"]},
        ],
    },
    {
        "key": "year2",
        "label": "Year 2",
        "number": "2",
        "classes": [
            {"code": "2LY", "current_label": "2LY", "aliases": ["2LY"]},
            {"code": "2S", "current_label": "2S", "aliases": ["2S"]},
        ],
    },
    {
        "key": "year3",
        "label": "Year 3",
        "number": "3",
        "classes": [
            {"code": "3B", "current_label": "3B", "aliases": ["3B"]},
            {"code": "3D", "current_label": "3D", "aliases": ["3D"]},
        ],
    },
    {
        "key": "year4",
        "label": "Year 4",
        "number": "4",
        "classes": [
            {"code": "4M", "current_label": "4M", "aliases": ["4M"]},
            {"code": "4W", "current_label": "4W", "aliases": ["4W"]},
        ],
    },
    {
        "key": "year5",
        "label": "Year 5",
        "number": "5",
        "classes": [
            {"code": "5L", "current_label": "5L", "aliases": ["5L"]},
            {"code": "5HP", "current_label": "5HP", "aliases": ["5HP"]},
        ],
    },
    {
        "key": "year6",
        "label": "Year 6",
        "number": "6",
        "classes": [
            {"code": "6BT", "current_label": "6BT", "aliases": ["6BT"]},
            {"code": "6R", "current_label": "6R", "aliases": ["6R"]},
        ],
    },
]

# alias (uppercase) -> (year_key, canonical class code)
ALIAS_TO_CLASS: dict[str, tuple[str, str]] = {}
# year_key -> [class codes]
YEAR_CLASS_CODES: dict[str, list[str]] = {}
# year_key -> display label, e.g. "Year 5"
YEAR_LABEL: dict[str, str] = {}
# "1".."6" / "R" -> year_key
YEAR_NUMBER_TO_KEY: dict[str, str] = {}

for group in YEAR_GROUPS:
    YEAR_CLASS_CODES[group["key"]] = [c["code"] for c in group["classes"]]
    YEAR_LABEL[group["key"]] = group["label"]
    YEAR_NUMBER_TO_KEY[group["number"]] = group["key"]
    for cls in group["classes"]:
        for alias in cls["aliases"]:
            ALIAS_TO_CLASS[alias.upper()] = (group["key"], cls["code"])

# Sort longest-first so e.g. "5HP" is tried before any shorter alias that
# might otherwise partially shadow it.
_ALIAS_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(a) for a in sorted(ALIAS_TO_CLASS, key=len, reverse=True)) + r")\b"
)
_WHOLE_SCHOOL_KEYWORDS = re.compile(r"\bwhole\s+school\b|\bKS[12]\b", re.IGNORECASE)
_YEAR_WORD_PATTERN = re.compile(r"\bYear\s+(\d)\b", re.IGNORECASE)
_YEAR_COMPOUND_PATTERN = re.compile(r"\bYear\s+\d\s*(?:and|&)\s*(\d)\b", re.IGNORECASE)
_RECEPTION_WORD_PATTERN = re.compile(r"\bReception\b", re.IGNORECASE)
# Fallback: any unrecognised class-code-shaped token, e.g. "6L", "5M". Kept
# case-sensitive since real class codes are always written upper-case in the
# school's event titles - a looser match risks false positives on ordinary
# capitalised words.
_UNKNOWN_CLASS_CODE_PATTERN = re.compile(r"\b([1-6][A-Z]{1,3}|R[A-Z]{1,3})\b")
# Days the school itself says it's closed - used to automatically skip
# occurrences of recurring manual events (see collect_closure_dates()).
_CLOSURE_KEYWORDS = re.compile(r"\bINSET\b|\bHALF TERM\b|\bHOLIDAY\b", re.IGNORECASE)
_RECUR_FREQ_MAP = {"DAILY": DAILY, "WEEKLY": WEEKLY, "MONTHLY": MONTHLY}


def classify_event(title: str) -> tuple[str, set[str]]:
    """Return (bucket, class_codes) for an event title.

    bucket is "whole-school" or "classes". class_codes is only populated for
    "classes" and lists which of the 14 class calendars the event belongs in.
    """
    if _WHOLE_SCHOOL_KEYWORDS.search(title):
        return "whole-school", set()

    matched_classes: set[str] = set()
    matched_years: set[str] = set()

    for alias in _ALIAS_PATTERN.findall(title.upper()):
        year_key, code = ALIAS_TO_CLASS[alias]
        matched_classes.add(code)
        matched_years.add(year_key)

    for m in _YEAR_WORD_PATTERN.finditer(title):
        matched_years.add(YEAR_NUMBER_TO_KEY[m.group(1)])
    for m in _YEAR_COMPOUND_PATTERN.finditer(title):
        matched_years.add(YEAR_NUMBER_TO_KEY[m.group(1)])
    if _RECEPTION_WORD_PATTERN.search(title):
        matched_years.add("reception")

    for token in _UNKNOWN_CLASS_CODE_PATTERN.findall(title):
        if token in ALIAS_TO_CLASS:
            continue
        lead = token[0]
        year_key = YEAR_NUMBER_TO_KEY.get(lead)
        if year_key:
            matched_years.add(year_key)
            print(
                f"WARNING: unrecognised class code '{token}' in event "
                f"{title!r} - treating as {YEAR_LABEL[year_key]}, added to "
                f"both of its class calendars. Add it to the CLASS config "
                f"in scripts/build_ics.py if it's a real/new class label.",
                file=sys.stderr,
            )

    if len(matched_years) >= 2:
        return "whole-school", set()
    if len(matched_years) == 1:
        (year_key,) = matched_years
        if matched_classes:
            return "classes", matched_classes
        return "classes", set(YEAR_CLASS_CODES[year_key])

    return "whole-school", set()


def fetch_events() -> list[dict]:
    window_start = date.today() - timedelta(days=FETCH_PAST_DAYS)
    window_end = date.today() + timedelta(days=FETCH_FUTURE_DAYS)
    params = {
        "pid": 3,
        "viewid": 1,
        "calid": 1,
        "bgedit": "false",
        "start": window_start.isoformat(),
        "end": window_end.isoformat(),
    }
    resp = requests.get(API_URL, params=params, headers=REQUEST_HEADERS, timeout=30)
    resp.raise_for_status()
    events = resp.json()
    if not isinstance(events, list):
        raise ValueError(f"Unexpected API response shape: {type(events)!r}")
    return events


def collect_closure_dates(raw_events: list[dict]) -> set[date]:
    """Every calendar date the school itself marks as closed (inset days,
    half term, holidays), read straight from the same API feed.

    Used to automatically skip occurrences of a *recurring* manual event
    (e.g. a weekly PE day) that would otherwise land on a day school isn't
    even open - reps don't have to think about term dates at all.
    """
    closure_dates: set[date] = set()
    for raw in raw_events:
        if not _CLOSURE_KEYWORDS.search(_clean(raw.get("title"))):
            continue
        if raw.get("allDay"):
            start, end = _parse_all_day(raw)
        else:
            start_dt, end_dt = _parse_timed(raw)
            start, end = start_dt.astimezone(LONDON).date(), end_dt.astimezone(LONDON).date()
            if end == start:
                end = start + timedelta(days=1)
        d = start
        while d < end:  # end is exclusive, matching DTEND semantics
            closure_dates.add(d)
            d += timedelta(days=1)
    return closure_dates


def _clean(text: str | None) -> str:
    return html.unescape((text or "").strip())


def _safe_url(url: str | None) -> str | None:
    """Reject anything but http(s). This value ends up as an <a href> on the
    public preview page (docs/assets/calendar.js), so a javascript: (or
    other) URL here would be a stored-XSS vector for every site visitor.
    Applies to both the school API's own `url` field and manual events -
    the latter can also arrive via hand-edited JSON, bypassing the class
    rep tool's own validation (tool/functions/api/_shared/validate.js)."""
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    return url if parsed.scheme in ("http", "https") else None


def _parse_all_day(raw: dict) -> tuple[date, date]:
    start_date = date.fromisoformat(raw["start"][:10])
    end_raw = raw.get("end")
    if end_raw:
        end_date = date.fromisoformat(end_raw[:10])
    else:
        end_date = start_date + timedelta(days=1)
    return start_date, end_date


def _parse_timed(raw: dict) -> tuple[datetime, datetime]:
    start_dt = datetime.fromisoformat(raw["start"]).replace(tzinfo=LONDON)
    end_raw = raw.get("end")
    if end_raw and "T" in end_raw:
        end_dt = datetime.fromisoformat(end_raw).replace(tzinfo=LONDON)
    else:
        # Some events only give a start time with no explicit end time (or
        # only a bare end date with no time-of-day). Default to a 1 hour
        # duration rather than guessing at a same-day cutoff.
        end_dt = start_dt + timedelta(hours=1)
    return start_dt.astimezone(UTC), end_dt.astimezone(UTC)


def build_event(raw: dict) -> Event:
    event = Event()
    event.add("uid", f"stpauls-{raw['id']}@{UID_DOMAIN}")
    event.add("summary", _clean(raw.get("title")))

    desc = _clean(raw.get("desc"))
    if desc:
        event.add("description", desc)

    url = _safe_url(raw.get("url"))
    if url:
        event.add("url", url)

    if raw.get("allDay"):
        dtstart, dtend = _parse_all_day(raw)
    else:
        dtstart, dtend = _parse_timed(raw)
    event.add("dtstart", dtstart)
    event.add("dtend", dtend)

    now = datetime.now(tz=UTC)
    event.add("dtstamp", now)
    event.add("last-modified", now)
    return event


def _single_day_dtstart_dtend(target_date: date, time_str: str | None, end_time_str: str | None):
    """DTSTART/DTEND for a single-day event on `target_date` - the same
    time-of-day rules build_manual_event uses for a non-multi-day event,
    factored out so a moved recurrence exception (always single-day, since
    it's one occurrence of an otherwise-single-day series) can reuse it."""
    if time_str:
        start_dt = datetime.combine(target_date, datetime.strptime(time_str, "%H:%M").time()).replace(tzinfo=LONDON)
        if end_time_str:
            end_dt = datetime.combine(target_date, datetime.strptime(end_time_str, "%H:%M").time()).replace(
                tzinfo=LONDON
            )
        else:
            end_dt = start_dt + timedelta(hours=1)
        return start_dt, end_dt
    return target_date, target_date + timedelta(days=1)


def _build_moved_exception_event(raw: dict, exception: dict) -> Event:
    """A single recurring occurrence moved to a new date/time (see the
    `exceptions` field) - a genuinely separate one-off VEVENT. Its UID is
    derived from the parent event's id plus the ORIGINAL occurrence date
    (not the new one), so re-running the build never creates duplicates or
    a new UID for the same exception."""
    event = Event()
    base_id = raw.get("id") or sha1(f"{raw['title']}|{raw['date']}".encode("utf-8")).hexdigest()[:16]
    event.add("uid", f"manual-{base_id}-{exception['date']}@{UID_DOMAIN}")
    event.add("summary", raw["title"])

    desc = raw.get("description")
    if desc:
        event.add("description", desc)
    url = _safe_url(raw.get("url"))
    if url:
        event.add("url", url)

    new_date = date.fromisoformat(exception["new_date"])
    new_time = exception.get("new_time") or raw.get("time")
    new_end_time = exception.get("new_end_time") or raw.get("end_time")
    dtstart, dtend = _single_day_dtstart_dtend(new_date, new_time, new_end_time)
    event.add("dtstart", dtstart)
    event.add("dtend", dtend)

    now = datetime.now(tz=UTC)
    event.add("dtstamp", now)
    event.add("last-modified", now)
    return event


def build_manual_event(raw: dict, code: str, closure_dates: set[date]) -> list[Event]:
    event = Event()
    # Manual events carry a stable `id` assigned at creation time by the
    # class-rep tool (see tool/functions/api/_shared/github.js), so editing
    # an event's title/date later updates the same iCalendar UID instead of
    # producing an apparent new event. Hand-edited entries that predate the
    # tool (or were added directly to the JSON without an id) fall back to a
    # content hash.
    if raw.get("id"):
        uid = raw["id"]
    else:
        uid_source = f"{code}|{raw['title']}|{raw['date']}|{raw.get('time', '')}"
        uid = sha1(uid_source.encode("utf-8")).hexdigest()[:16]
    event.add("uid", f"manual-{uid}@{UID_DOMAIN}")
    event.add("summary", raw["title"])

    desc = raw.get("description")
    if desc:
        event.add("description", desc)

    url = _safe_url(raw.get("url"))
    if url:
        event.add("url", url)

    start_date = date.fromisoformat(raw["date"])
    end_date_raw = raw.get("end_date")
    # Defensive: a hand-edited JSON entry could have end_date before date.
    end_date = max(date.fromisoformat(end_date_raw), start_date) if end_date_raw else start_date

    time_str = raw.get("time")
    if time_str:
        start_dt = datetime.combine(start_date, datetime.strptime(time_str, "%H:%M").time()).replace(tzinfo=LONDON)
        end_time_str = raw.get("end_time")
        if end_time_str:
            end_dt = datetime.combine(end_date, datetime.strptime(end_time_str, "%H:%M").time()).replace(
                tzinfo=LONDON
            )
        elif end_date != start_date:
            # Multi-day with only a start time given (e.g. a residential trip
            # with no stated return time) - run through to the end of the
            # last day rather than guessing a same-length window.
            end_dt = datetime.combine(end_date, dt_time(23, 59)).replace(tzinfo=LONDON)
        else:
            end_dt = start_dt + timedelta(hours=1)
        # Keep these in Europe/London (not UTC-normalised): a UTC DTSTART
        # would make a recurring event repeat at a fixed UTC instant rather
        # than the same local wall-clock time, silently shifting by an hour
        # for any occurrence on the other side of a DST change. Every
        # mainstream calendar app resolves this TZID natively; a VTIMEZONE
        # is also embedded below (add_missing_timezones()) for parsers that
        # don't recognise IANA ids directly.
        event.add("dtstart", start_dt)
        event.add("dtend", end_dt)
    else:
        event.add("dtstart", start_date)
        # DTEND is exclusive in iCalendar, so a single all-day event still
        # ends the following day; a multi-day one ends the day after its
        # last (inclusive) day.
        event.add("dtend", end_date + timedelta(days=1))

    moved_events: list[Event] = []
    exception_by_date: dict[date, dict] = {}
    for exc in raw.get("exceptions") or []:
        try:
            exception_by_date[date.fromisoformat(exc["date"])] = exc
        except (KeyError, ValueError):
            continue

    recurrence = raw.get("recurrence")
    if recurrence and recurrence.get("freq"):
        freq_name = recurrence["freq"]
        interval = recurrence.get("interval", 1)
        rrule_params = {"freq": freq_name, "interval": interval}
        until_raw = recurrence.get("until")
        until_date = date.fromisoformat(until_raw) if until_raw else None
        if until_date:
            if time_str:
                # RFC 5545: UNTIL must be a UTC date-time when DTSTART has a
                # time component - use the end of that day so the last
                # occurrence itself isn't excluded by an early cutoff.
                rrule_params["until"] = datetime.combine(until_date, dt_time(23, 59, 59), tzinfo=UTC)
            else:
                rrule_params["until"] = until_date
        event.add("rrule", rrule_params)

        # Skip occurrences that land on a day the school is closed (inset
        # days, half term, holidays - see collect_closure_dates()), a
        # weekend for a daily repeat, or a date the rep has explicitly
        # overridden (see `exceptions` - a single occurrence moved or
        # cancelled, e.g. one week's PE swapping for a church service), by
        # enumerating the series ourselves and excluding those dates via
        # EXDATE. The RRULE above still describes the full pattern; EXDATE
        # is the standard iCalendar way to carve out exceptions from it.
        if until_date and freq_name in _RECUR_FREQ_MAP:
            occurrences = rrule(
                _RECUR_FREQ_MAP[freq_name],
                dtstart=datetime.combine(start_date, dt_time.min),
                until=datetime.combine(until_date, dt_time.max),
                interval=interval,
            )
            exdates = []
            for occ in occurrences:
                occ_date = occ.date()
                is_closure = occ_date in closure_dates
                is_weekend = freq_name == "DAILY" and occ_date.weekday() >= 5
                is_exception = occ_date in exception_by_date
                if not (is_closure or is_weekend or is_exception):
                    continue
                if time_str:
                    # Same reasoning as dtstart/dtend above: EXDATE must
                    # match DTSTART's value type/zone to actually match and
                    # exclude the occurrence.
                    exdates.append(datetime.combine(occ_date, start_dt.timetz()))
                else:
                    exdates.append(occ_date)
            if exdates:
                event.add("exdate", exdates)

        for exc in exception_by_date.values():
            if exc.get("action") == "moved":
                moved_events.append(_build_moved_exception_event(raw, exc))

    now = datetime.now(tz=UTC)
    event.add("dtstamp", now)
    event.add("last-modified", now)
    return [event, *moved_events]


def load_manual_events(code: str) -> list[dict]:
    path = MANUAL_EVENTS_DIR / f"{code.lower()}.json"
    if not path.exists():
        return []
    with path.open() as f:
        return json.load(f)


def make_calendar(name: str, events: list[Event]) -> Calendar:
    cal = Calendar()
    cal.add("prodid", f"-//{UID_DOMAIN}//stpauls-enfield//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", name)
    cal.add("x-wr-timezone", "Europe/London")
    for event in events:
        cal.add_component(event)
    # No-op if nothing uses a TZID; embeds a VTIMEZONE block for Europe/London
    # otherwise, for the benefit of parsers that don't recognise IANA zone
    # ids directly (mainstream calendar apps resolve the TZID from their own
    # timezone database regardless).
    cal.add_missing_timezones()
    return cal


def main() -> None:
    raw_events = fetch_events()
    closure_dates = collect_closure_dates(raw_events)

    seen_ids: set[int] = set()
    whole_school_events: list[Event] = []
    class_events: dict[str, list[Event]] = {code: [] for codes in YEAR_CLASS_CODES.values() for code in codes}

    for raw in raw_events:
        if raw["id"] in seen_ids:
            continue
        seen_ids.add(raw["id"])

        bucket, class_codes = classify_event(_clean(raw.get("title")))
        event = build_event(raw)
        if bucket == "whole-school":
            whole_school_events.append(event)
        else:
            for code in class_codes:
                class_events[code].append(event)

    CALENDARS_DIR.mkdir(parents=True, exist_ok=True)

    cal = make_calendar(f"{SCHOOL_NAME} — Whole School", whole_school_events)
    (CALENDARS_DIR / "whole-school.ics").write_bytes(cal.to_ical())
    print(f"Wrote {len(whole_school_events)} events to whole-school.ics", file=sys.stderr)

    for group in YEAR_GROUPS:
        for cls in group["classes"]:
            code = cls["code"]
            events = class_events[code] + [
                event
                for raw in load_manual_events(code)
                for event in build_manual_event(raw, code, closure_dates)
            ]
            cal = make_calendar(f"{SCHOOL_NAME} — {group['label']} ({cls['current_label']})", events)
            (CALENDARS_DIR / f"{code.lower()}.ics").write_bytes(cal.to_ical())
            print(f"Wrote {len(events)} events to {code.lower()}.ics", file=sys.stderr)

    fosps_events = [
        event
        for raw in load_manual_events("fosps")
        for event in build_manual_event(raw, "fosps", closure_dates)
    ]
    cal = make_calendar(f"{SCHOOL_NAME} — Friends of St Paul's (FOSPS)", fosps_events)
    (CALENDARS_DIR / "fosps.ics").write_bytes(cal.to_ical())
    print(f"Wrote {len(fosps_events)} events to fosps.ics", file=sys.stderr)


if __name__ == "__main__":
    main()
