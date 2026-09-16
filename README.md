# school-calendar-feed

Turns [St Paul's C of E Primary (Enfield)](https://www.st-pauls.enfield.sch.uk/calendar/?calid=1&pid=3&viewid=1)'s
"Upcoming Events" calendar into a set of subscribable `.ics` feeds, split by
audience, so parents can subscribe to only what's relevant to them (their
child's class) instead of one firehose calendar of everything.

The school's calendar page is rendered by FullCalendar.js from an
unauthenticated JSON API (`/calendar/api.asp`). `scripts/build_ics.py` queries
that API directly, classifies each event, and writes one `.ics` file per
calendar into `docs/calendars/`.

## Calendars produced

- **`whole-school.ics`** - events affecting the whole school or multiple year
  groups: inset days, holidays, KS1/KS2-wide events, whole-school services,
  etc. This is also the fallback bucket for anything that doesn't look
  class/year-specific.
- **One per class, 14 total** (`rr.ics`, `rgp.ics`, `1ms.ics`, `1t.ics`,
  `2ly.ics`, `2s.ics`, `3b.ics`, `3d.ics`, `4m.ics`, `4w.ics`, `5l.ics`,
  `5hp.ics`, `6bt.ics`, `6r.ics`) - an event for a specific class (e.g. "5HP
  Collective Worship") appears only in that class's calendar; an event for a
  whole year group (e.g. "Year 5 to Celtic Harmony") appears in both of that
  year's class calendars.
- **`fosps.ics`** - Friends of St Paul's (the parents' fundraising charity).
  Not published by the school's API at all - see below.

An event never appears in more than one of these top-level buckets (it's
either whole-school, or in one/both of a single year's two class calendars,
never both whole-school *and* class-specific).

### How classification works

The API gives no structured "which year/class is this for" field, so
`scripts/build_ics.py` classifies purely from the event title:

1. If the title mentions "whole school", "KS1" or "KS2" → whole-school.
2. If it names a specific class code (from the `YEAR_GROUPS` config at the
   top of the script) → that class only.
3. If it names exactly one year group (by "Year N", "Reception", or an
   unrecognised-but-year-shaped class code like a new teacher's initials) →
   both classes in that year group.
4. If it names more than one year group (e.g. "Eucharist Year 5 and Year 6")
   → whole-school, on the same logic the school itself uses when it calls a
   KS2-wide meeting "for parents" rather than naming individual classes.
5. Otherwise (no year/class reference at all, e.g. "Back to School", "Half
   Term Break") → whole-school.

Class labels change over time (they're teacher-initials-based, and teachers
change). When the script sees a class-code-shaped token it doesn't recognise
(e.g. "6L"), it logs a warning to stderr, figures out the year group from the
leading digit/R, and fans the event out to both of that year's classes so no
one misses it. Check the Action's logs occasionally for these warnings and
add newly-seen class codes as aliases in `YEAR_GROUPS` in
`scripts/build_ics.py`.

### FOSPS events

FOSPS doesn't publish a scrapable calendar, so its events are entered by hand
into `data/fosps_events.json` - a plain JSON list, edited directly (by a
person, or by an AI agent fed a newsletter/PDF/photo of a poster). Each entry
looks like:

```json
{
  "title": "FOSPS AGM",
  "date": "2026-10-05",
  "time": "19:30",
  "end_time": "21:00",
  "description": "Annual general meeting, all welcome.",
  "url": "https://example.com/fosps-agm"
}
```

`time`/`end_time`/`description`/`url` are optional - omit `time` for an
all-day event.

## How it works

- `.github/workflows/update-calendar.yml` runs `scripts/build_ics.py` every 6
  hours via GitHub Actions, and commits `docs/calendars/*.ics` if anything
  changed.
- GitHub Pages serves `docs/` as a static site, so the feeds are published at
  `https://pete-naish.github.io/school-calendar-feed/calendars/<name>.ics`.
- `docs/index.html` is a landing page listing every calendar with subscribe
  links for Google Calendar, Apple Calendar, and Outlook.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/build_ics.py   # writes docs/calendars/*.ics
```

## One-time setup

In the repo's GitHub Settings → Pages, set **Source: Deploy from a branch**,
branch `main`, folder `/docs`.

## Scope

This covers only what's published on the school's public Upcoming Events page
(inset days, whole-school events, trips, class collective worship slots,
etc), plus hand-entered FOSPS events. Anything not published anywhere
scrapable (e.g. weekly PE days) isn't included here.

Not affiliated with the school or FOSPS - this just re-publishes their public
event data in a more convenient, filterable format.
