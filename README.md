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

Each class in `YEAR_GROUPS` has a permanent `code` (the `.ics` filename /
subscribe URL slug - e.g. always `5hp.ics`) separate from a `current_label`
(what's shown in the calendar's display name and in the tool's UI). When a
class relabels, add the new label to `aliases` and update `current_label` -
**never change `code`**, or every parent subscribed to that class breaks
their subscription.

### Manual / hand-entered events (class events + FOSPS)

Class-specific events not published anywhere scrapable (class trips, extra
collective-worship dates, etc) and all FOSPS events (FOSPS doesn't publish a
scrapable calendar at all) are entered by hand into
`data/manual_events/<code>.json` - one plain JSON list per calendar (e.g.
`data/manual_events/5hp.json`, `data/manual_events/fosps.json`), merged into
that calendar's `.ics` alongside anything from the school API.

The primary way to add these is **[the class rep tool](tool/README.md)** - a
password-protected web app where a class rep pastes free text (a WhatsApp
message, newsletter paragraph, etc) and has it turned into structured events
by Claude, then reviews/edits/saves. It also supports amending or deleting an
already-saved event.

Editing the JSON files directly remains a documented fallback. Each entry
looks like:

```json
{
  "id": "a1b2c3d4e5f6",
  "title": "FOSPS AGM",
  "date": "2026-10-05",
  "end_date": null,
  "time": "19:30",
  "end_time": "21:00",
  "description": "Annual general meeting, all welcome.",
  "url": "https://example.com/fosps-agm",
  "recurrence": null
}
```

`id` should be a short unique string (the tool generates one automatically;
if adding an entry by hand, any unique value works) - it's what lets an event
be edited later without becoming a "new" entry in subscribers' calendar apps.
`end_date`/`time`/`end_time`/`description`/`url`/`recurrence` are all
optional (omit or set `null`).

- Omit `time` for an all-day event.
- Set `end_date` for a multi-day event (its last day, inclusive) - otherwise
  it's a single-day event.
- `recurrence` is `{"freq": "DAILY"|"WEEKLY"|"MONTHLY", "interval": 1, "until": "2027-04-01"}`
  (becomes a standard iCalendar `RRULE`). Always set `until` by hand if
  editing the JSON directly - the class rep tool enforces this, but nothing
  stops a hand-added entry from recurring forever if you leave it out.

A recurring event automatically skips any occurrence that would land on a
day the school itself marks as closed - inset days, half term, holidays
(detected from the same school API feed by `collect_closure_dates()` in
`scripts/build_ics.py`, matching "INSET"/"HALF TERM"/"HOLIDAY" in event
titles), plus weekends for a daily repeat. This is encoded as standard
iCalendar `EXDATE` exceptions on the recurring `RRULE`, so it works in every
calendar app without the rep having to think about term dates at all.

## How it works

- `.github/workflows/update-calendar.yml` runs `scripts/build_ics.py` every 6
  hours via GitHub Actions, and commits `docs/calendars/*.ics` if anything
  changed.
- GitHub Pages serves `docs/` as a static site, so the feeds are published at
  `https://pete-naish.github.io/school-calendar-feed/calendars/<name>.ics`.
- `docs/index.html` is a landing page listing every calendar with subscribe
  links for Google Calendar, Apple Calendar, and Outlook.
- `tool/` is a separately-deployed (Cloudflare Pages) web app - see
  [tool/README.md](tool/README.md) - that commits to `data/manual_events/`
  directly; it doesn't itself rebuild the `.ics` files, it just feeds the
  same 6-hourly cron above.

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

This covers what's published on the school's public Upcoming Events page
(inset days, whole-school events, trips, class collective worship slots,
etc), plus whatever class reps or FOSPS add manually via [the class rep
tool](tool/README.md) or by hand-editing `data/manual_events/`.

Not affiliated with the school or FOSPS - this just re-publishes their public
event data in a more convenient, filterable format.
