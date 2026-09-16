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
- calendars/fosps.ics          - Friends of St Paul's events. Not published
                                  by the school API at all; sourced from
                                  data/fosps_events.json, which is maintained
                                  by hand (or by an AI agent working from
                                  newsletters/PDFs).

Classification is title-based (the API gives no structured category), using
the CLASS config below plus a few keyword rules. Unrecognised class-code-shaped
tokens (e.g. a teacher's initials changing) are logged as warnings and fall
back to both classes in that year group, so no one misses an event outright.
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from icalendar import Calendar, Event

API_URL = "https://www.st-pauls.enfield.sch.uk/calendar/api.asp"
SCHOOL_NAME = "St Paul's Enfield"
UID_DOMAIN = "school-calendar-feed"
CALENDARS_DIR = Path(__file__).resolve().parent.parent / "docs" / "calendars"
FOSPS_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "fosps_events.json"

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
# `aliases` are all the labels the school has used (or might use) for a
# class, e.g. Reception's classes were "RKJ"/"RKP" and are now "RR"/"RGP".
# Keep old aliases around rather than deleting them - the school's own event
# titles are the only signal we get, and old ones can resurface in stale
# copy/pasted event titles.
#
# When the school starts using a class label that isn't listed here (e.g. a
# new teacher), classify_event() below still figures out the *year group*
# from the leading digit/R and fans the event out to both of that year's
# classes, logging a warning so this config can be updated.
# --------------------------------------------------------------------------
YEAR_GROUPS = [
    {
        "key": "reception",
        "label": "Reception",
        "number": "R",
        "classes": [
            {"code": "RR", "aliases": ["RR", "RKJ"]},
            {"code": "RGP", "aliases": ["RGP", "RKP"]},
        ],
    },
    {
        "key": "year1",
        "label": "Year 1",
        "number": "1",
        "classes": [
            {"code": "1MS", "aliases": ["1MS"]},
            {"code": "1T", "aliases": ["1T"]},
        ],
    },
    {
        "key": "year2",
        "label": "Year 2",
        "number": "2",
        "classes": [
            {"code": "2LY", "aliases": ["2LY"]},
            {"code": "2S", "aliases": ["2S"]},
        ],
    },
    {
        "key": "year3",
        "label": "Year 3",
        "number": "3",
        "classes": [
            {"code": "3B", "aliases": ["3B"]},
            {"code": "3D", "aliases": ["3D"]},
        ],
    },
    {
        "key": "year4",
        "label": "Year 4",
        "number": "4",
        "classes": [
            {"code": "4M", "aliases": ["4M"]},
            {"code": "4W", "aliases": ["4W"]},
        ],
    },
    {
        "key": "year5",
        "label": "Year 5",
        "number": "5",
        "classes": [
            {"code": "5L", "aliases": ["5L"]},
            {"code": "5HP", "aliases": ["5HP"]},
        ],
    },
    {
        "key": "year6",
        "label": "Year 6",
        "number": "6",
        "classes": [
            {"code": "6BT", "aliases": ["6BT"]},
            {"code": "6R", "aliases": ["6R"]},
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


def _clean(text: str | None) -> str:
    return html.unescape((text or "").strip())


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

    url = raw.get("url")
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


def build_fosps_event(raw: dict) -> Event:
    event = Event()
    uid_source = f"{raw['title']}|{raw['date']}|{raw.get('time', '')}"
    uid = sha1(uid_source.encode("utf-8")).hexdigest()[:16]
    event.add("uid", f"fosps-{uid}@{UID_DOMAIN}")
    event.add("summary", raw["title"])

    desc = raw.get("description")
    if desc:
        event.add("description", desc)

    url = raw.get("url")
    if url:
        event.add("url", url)

    start_date = date.fromisoformat(raw["date"])
    time_str = raw.get("time")
    if time_str:
        start_dt = datetime.combine(start_date, datetime.strptime(time_str, "%H:%M").time()).replace(tzinfo=LONDON)
        end_time_str = raw.get("end_time")
        if end_time_str:
            end_dt = datetime.combine(start_date, datetime.strptime(end_time_str, "%H:%M").time()).replace(
                tzinfo=LONDON
            )
        else:
            end_dt = start_dt + timedelta(hours=1)
        event.add("dtstart", start_dt.astimezone(UTC))
        event.add("dtend", end_dt.astimezone(UTC))
    else:
        event.add("dtstart", start_date)
        event.add("dtend", start_date + timedelta(days=1))

    now = datetime.now(tz=UTC)
    event.add("dtstamp", now)
    event.add("last-modified", now)
    return event


def load_fosps_events() -> list[dict]:
    if not FOSPS_DATA_PATH.exists():
        return []
    with FOSPS_DATA_PATH.open() as f:
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
    return cal


def main() -> None:
    raw_events = fetch_events()

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
            events = class_events[code]
            cal = make_calendar(f"{SCHOOL_NAME} — {group['label']} ({code})", events)
            (CALENDARS_DIR / f"{code.lower()}.ics").write_bytes(cal.to_ical())
            print(f"Wrote {len(events)} events to {code.lower()}.ics", file=sys.stderr)

    fosps_raw = load_fosps_events()
    fosps_events = [build_fosps_event(raw) for raw in fosps_raw]
    cal = make_calendar(f"{SCHOOL_NAME} — Friends of St Paul's (FOSPS)", fosps_events)
    (CALENDARS_DIR / "fosps.ics").write_bytes(cal.to_ical())
    print(f"Wrote {len(fosps_events)} events to fosps.ics", file=sys.stderr)


if __name__ == "__main__":
    main()
