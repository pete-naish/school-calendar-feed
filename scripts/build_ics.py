#!/usr/bin/env python3
"""Fetch St Paul's C of E Primary (Enfield) upcoming events and write an .ics feed.

The school's public calendar page (https://www.st-pauls.enfield.sch.uk/calendar/)
is rendered client-side by FullCalendar.js, which itself pulls events from an
unauthenticated JSON API. This script queries that API directly and converts
the result into a standard iCalendar file that parents can subscribe to.
"""
from __future__ import annotations

import html
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from icalendar import Calendar, Event

API_URL = "https://www.st-pauls.enfield.sch.uk/calendar/api.asp"
CALENDAR_NAME = "St Paul's C of E Primary (Enfield) - Upcoming Events"
UID_DOMAIN = "school-calendar-feed"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "calendar.ics"

LONDON = ZoneInfo("Europe/London")
UTC = timezone.utc

# The API rejects overly wide date ranges (a ~7 year span 400s), so keep the
# fetch window modest: a bit of recent history plus a year ahead.
FETCH_PAST_DAYS = 30
FETCH_FUTURE_DAYS = 365

REQUEST_HEADERS = {
    "User-Agent": "school-calendar-feed/1.0 (personal family calendar sync)",
}


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


def build_calendar(raw_events: list[dict]) -> Calendar:
    cal = Calendar()
    cal.add("prodid", f"-//{UID_DOMAIN}//stpauls-enfield//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", CALENDAR_NAME)
    cal.add("x-wr-timezone", "Europe/London")

    seen_ids = set()
    for raw in raw_events:
        if raw["id"] in seen_ids:
            continue
        seen_ids.add(raw["id"])
        cal.add_component(build_event(raw))

    return cal


def main() -> None:
    raw_events = fetch_events()
    cal = build_calendar(raw_events)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_bytes(cal.to_ical())

    print(f"Wrote {len(cal.subcomponents)} events to {OUTPUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
