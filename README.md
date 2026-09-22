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
- **One per class, 14 total** - an event for a specific class (e.g. "5HP
  Collective Worship") appears only in that class's calendar; an event for a
  whole year group (e.g. "Year 5 to Celtic Harmony") appears in both of that
  year's class calendars. Each file is named for a permanent class *slot*, not
  for the class's current label (which changes with teachers):

  | Year | First class | Second class |
  |---|---|---|
  | Reception | `rec-a.ics` (RR) | `rec-b.ics` (RGP) |
  | Year 1 | `y1-a.ics` (1S) | `y1-b.ics` (1T) |
  | Year 2 | `y2-a.ics` (2L) | `y2-b.ics` (2MS) |
  | Year 3 | `y3-a.ics` (3B) | `y3-b.ics` (3D) |
  | Year 4 | `y4-a.ics` (4W) | `y4-b.ics` (4Y) |
  | Year 5 | `y5-a.ics` (5HP) | `y5-b.ics` (5M) |
  | Year 6 | `y6-a.ics` (6L) | `y6-b.ics` (6R) |

- **`fosps.ics`** - Friends of St Paul's (the parents' fundraising charity).
  Not published by the school's API at all - see below.

An event never appears in more than one of these top-level buckets (it's
either whole-school, or in one/both of a single year's two class calendars,
never both whole-school *and* class-specific).

Every class/FOSPS event's *published* title is prefixed with its calendar's
label (e.g. "PE Kit" becomes "RR: PE Kit") - useful for a parent subscribed
to more than one class calendar (siblings in different year groups), who'd
otherwise see identically-titled events from each with no way to tell them
apart at a glance. This only affects the `.ics` `SUMMARY` at build time -
nothing stored (a title typed into the class rep tool, or `data/manual_events/`
JSON) ever has the prefix baked in. Whole-school events are never prefixed,
since a parent only ever gets them from the one whole-school calendar.

**All 16 calendars are always generated and published**, regardless of
what's launched on the landing page. `docs/index.html` has no per-calendar
markup: `docs/assets/calendar.js` renders one rail row per code in
`LAUNCHED_CALENDARS` (a preview checkbox), three platform buttons (Apple
Calendar / Google Calendar / Outlook) that add whichever calendars are
ticked - one feed per click, so several ticked fan out to a list - plus
plain feed links in the facts strip, all with URLs derived from wherever
the page is served, and names the rest in a one-line "coming soon" note.
Currently launched:
Whole School, FOSPS and Reception (`rec-a`/`rec-b`). To launch a calendar, add its `code`
to `LAUNCHED_CALENDARS` - no other change needed, the `.ics` file has been
there the whole time.

### How classification works

The API gives no structured "which year/class is this for" field, so
`scripts/build_ics.py` classifies purely from the event title:

1. If the title mentions "whole school", "KS1" or "KS2" → whole-school.
2. If it names a specific class code (from the `YEAR_GROUPS` config at the
   top of the script) → that class only.
3. If it names exactly one year group (by "Year N", "Reception", or an
   unrecognised-but-year-shaped class code like a new teacher's initials) →
   both classes in that year group.
4. If it names more than one year group (e.g. "Eucharist Year 5 and Year 6",
   "Information meeting - Year 1 and 2") → every class in each named year
   (or just the class named, where a year's class is named specifically).
   A range ("Reception to Year 6", "Year 3-6") names only its ends, so it
   falls back to whole-school rather than missing the years in between; so do
   "KS1"/"KS2"/"whole school" (rule 1).
5. Otherwise (no year/class reference at all, e.g. "Back to School", "Half
   Term Break") → whole-school.

Class labels change over time (they're teacher-initials-based, and teachers
change). When the script sees a class-code-shaped token it doesn't recognise
(e.g. "6Z"), it logs a warning to stderr, figures out the year group from the
leading digit/R, and fans the event out to both of that year's classes so no
one misses it. The build reports these in its "Calendar build problems" issue
(see "How it works"); add the newly-seen label as an alias in `YEAR_GROUPS` in
`scripts/build_ics.py`.

Each class in `YEAR_GROUPS` has a permanent, generic `code` - a *slot*: `rec-a`
and `rec-b` for Reception, `y1-a`/`y1-b` ... `y6-a`/`y6-b` for the years (a and
b started out in alphabetical order of label, but a relabel never swaps them,
so they drift over time; every list people see is sorted by label instead) - separate from its
`current_label` (`5HP`, `6L`...: what the school calls it now). The code is the
feed's filename and subscribe URL, the class rep's passcode key and the name of
its data file, and it says nothing about a teacher, so it never has to change.
It also can't be mistaken for a school label (`y3-b` is not class 3B). The
label is what people see: the calendar's name, the tool's picker, and the
prefix on every event title.

When a class relabels (a new teacher, a new year, or a correction like 5L ->
5M): update its `current_label` and replace its entry in `aliases` with the
new label. That's all - no URL, passcode or data file moves. **Never change a
`code`**, or everyone subscribed to that feed breaks. An event title still
using an old label falls back to both classes in that year group.

### Manual / hand-entered events (class events + FOSPS)

Class-specific events not published anywhere scrapable (class trips, extra
collective-worship dates, etc) and all FOSPS events (FOSPS doesn't publish a
scrapable calendar at all) are entered by hand into
`data/manual_events/<code>.json` - one plain JSON list per calendar (e.g.
`data/manual_events/y5-b.json`, `data/manual_events/fosps.json`), merged into
that calendar's `.ics` alongside anything from the school API.

An event for a whole year group (e.g. a Reception trip for both RR and RGP)
is stored once, in `data/manual_events/<year key>.json` - `reception.json`,
`year1.json` ... `year6.json` (the `key` of each entry in `YEAR_GROUPS` in
`scripts/build_ics.py`) - the same format as a class file. Every class in that
year builds those events into its own feed (each with its own `RR:` / `RGP:`
title prefix), so editing or deleting one changes it for the whole year. The
file is optional; the class rep tool creates it on first use.

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
  "location": "School hall",
  "url": "https://example.com/fosps-agm",
  "recurrence": null,
  "exceptions": []
}
```

`id` should be a short unique string (the tool generates one automatically;
if adding an entry by hand, any unique value works) - it's what lets an event
be edited later without becoming a "new" entry in subscribers' calendar apps.
`end_date`/`time`/`end_time`/`description`/`location`/`url`/`recurrence`/`exceptions`
are all optional (omit, set `null`, or `[]`).

- Omit `time` for an all-day event.
- `location` is plain text (becomes the event's iCalendar `LOCATION`, which
  calendar apps show and can open in a map).
- Set `end_date` for a multi-day event (its last day, inclusive) - otherwise
  it's a single-day event.
- `recurrence` is `{"freq": "DAILY"|"WEEKLY"|"MONTHLY", "interval": 1, "until": "2027-04-01"}`
  (becomes a standard iCalendar `RRULE`). Always set `until` by hand if
  editing the JSON directly - the class rep tool enforces this, but nothing
  stops a hand-added entry from recurring forever if you leave it out.
- `exceptions` overrides a single occurrence of a `recurrence` (e.g. one
  week's PE clashes with something else and moves to Friday, without
  touching the rest of the series): a list of
  `{"date": "2026-10-15", "action": "cancelled"}` or
  `{"date": "2026-10-15", "action": "moved", "new_date": "2026-10-16",
  "new_time": "09:00", "new_end_time": "10:00"}` (`new_time`/`new_end_time`
  optional, default to the parent event's own `time`/`end_time`). `date` is
  the *original* occurrence being overridden. Meaningless without
  `recurrence` - ignored if present without one.

A recurring event automatically skips any occurrence that would land on a
day the school itself marks as closed - inset days, half term, holidays
(detected from the same school API feed by `collect_closure_dates()` in
`scripts/build_ics.py`, matching "INSET"/"HALF TERM"/"HOLIDAY" in event
titles), plus weekends for a daily repeat, using the same `EXDATE`
mechanism as a rep-added `exceptions` entry above - both are just dates
carved out of the `RRULE`, so it works in every calendar app without the
rep having to think about term dates at all.

**Timed manual events use a `TZID=Europe/London` DTSTART/DTEND/EXDATE (not
UTC)**, with a `VTIMEZONE` block auto-embedded by `Calendar.add_missing_timezones()`
(`icalendar` >= 7). This matters specifically for *recurring* events: a
UTC-normalised DTSTART makes an RRULE repeat at a fixed UTC instant rather
than the same local wall-clock time, so a weekly "9am" event would silently
become an 8am or 10am event for any occurrence on the other side of a British
clock change. `RRULE`'s `UNTIL` and school-API-sourced (never recurring)
events are unaffected and stay UTC, per RFC 5545 (`UNTIL` must always be UTC
when `DTSTART` has a time component).

### Whole School event descriptions and locations

Whole-school events (inset days, holidays, whole-school services, etc)
aren't hand-entered at all - see "How classification works" above - they
come straight from the school's own API on every 6-hourly build, so
there's no `data/manual_events/whole-school.json` to edit. [The class rep
tool](tool/README.md) still has a **Whole School** calendar entry with its
own passcode, but it can only edit an already-published event's
*description* (e.g. adding parking or kit notes to an inset day) and add a
*location* (the school's feed has none) - never its title, date, or whether
it exists at all, since none of that is this tool's to control; adding and
deleting events is disabled entirely for this entry. Saved edits live in
`data/whole_school_overrides.json`
(`{"<school event id>": {"description": "...", "location": "..."}}`, either
key optional, keyed by the id embedded in that event's own UID) and are
applied by `scripts/build_ics.py` on the next build - triggered straight after a save, see the tool's "Publishing
changes" section. An override whose event has vanished from the school's feed
is pruned on that same build. The same overrides apply to school-sourced
events that were routed to a class calendar instead: a class's tool entry
lists them (flagged as coming from the school's calendar) with the same
description/location-only editing.

## Calendar preview (`docs/index.html`)

The landing page embeds an interactive calendar (`docs/assets/calendar.js`,
`docs/assets/calendar.css`) that fetches and parses all 16 `.ics` files
client-side with [ical.js](https://github.com/kewisch/ical.js) - including
expanding `RRULE`/`EXDATE` - so parents can see what they'd actually get
before subscribing anywhere, or just use the page itself as their calendar.
The `.ics` fetches only happen once at page load, so a "↻ Refresh" button
next to "Today" re-fetches and redraws without a full page reload (via
`loadAllCalendarData()`, shared with the initial load) - useful right after
a class rep saves a new event, since the page itself has no way to know
that happened otherwise.
It sits directly under the hero copy as the page's visual - a first-time
visitor sees what they'd get before they pick a class. The class tiles in
the calendar header are both the preview toggles and the subscribe
actions, so there is no separate subscribe section; the hero's "Add a
class to your calendar" button scrolls to them. Only launched calendars
get a tile (`LAUNCHED_CALENDARS` in `calendar.js`); a not-yet-launched
calendar's `.ics` is still fetched and ready the moment it's launched,
nothing else needs to change. Month/Week/Day views (button group in the nav bar) share one `viewedDate`
anchor whose meaning depends on the active view (1st-of-month / that week's
Monday / the exact day - see `normalizeAnchor()`); switching views keeps
"today" in view when it's already visible, rather than always re-deriving
from the current anchor. Each calendar has an on/off toggle, remembered
per-browser in `localStorage` (default: Whole School + FOSPS on, classes
off) - the active view is remembered the same way. Colors are one
categorical OKLCH hue per year group + FOSPS at a shared lightness and
chroma, with a lighter tint for the second class in each year, and
"Everyone" (whole school) as a neutral grey rather than a 9th hue (see
`docs/assets/calendar.css` for the values and contrast notes).

Because `ical.js`'s own offset math for an `add_missing_timezones()`-style
(RDATE-list) `VTIMEZONE` doesn't reliably resolve the correct side of a DST
change, `calendar.js` registers the embedded `VTIMEZONE` (for EXDATE/RRULE
matching) but independently recomputes each occurrence's actual displayed
time using the browser's own `Intl` timezone data (`timeZoneOffsetMs()` /
`londonWallClockToUtc()`) - verified correct regardless of the viewer's own
device timezone.

## How it works

- `.github/workflows/update-calendar.yml` runs `scripts/build_ics.py` every 6
  hours via GitHub Actions - and immediately after any change made through
  the class rep tool - and commits `docs/calendars/*.ics` if anything
  changed (plus `data/whole_school_overrides.json` when stale overrides were
  pruned, see below). If the push is rejected because something else landed
  on `main` mid-build (another save from the tool, say), the run discards its
  build and rebuilds on top of the new tip rather than merging - the `.ics`
  files carry build timestamps, so two builds always conflict.
- The workflows pin each GitHub Action to a commit SHA (with its version in a
  comment) rather than a tag, and `.github/workflows/test.yml` runs with
  read-only permissions. `.github/dependabot.yml` opens a weekly pull request
  for newer Actions and Python requirements, so the pins get bumped - and the
  tests run against them - instead of going stale.
- Problems the build finds - an event it couldn't build (skipped, so **missing
  from the feeds**), a class label it doesn't recognise (see "How
  classification works" above), or the school's calendar coming back empty - go to the run's
  summary and to a single open issue, "Calendar build problems": opened when the
  first one appears (that's your one notification), edited quietly while they
  last, and closed by the first clean build. `build_ics.py` writes them to the
  JSON file named by `BUILD_REPORT_PATH`, `scripts/build_report.py` turns that
  into Markdown, and the workflow's last step does the rest. It runs after the
  push and is allowed to fail, so reporting can never stop the feeds
  publishing.
- GitHub Pages serves `docs/` as a static site, so the feeds are published at
  `https://pete-naish.github.io/school-calendar-feed/calendars/<name>.ics`.
- `docs/index.html` is a landing page listing every calendar with subscribe
  links for Google Calendar, Apple Calendar, and Outlook, plus the
  interactive preview calendar described above.
  Its fonts (Geist, under the SIL Open Font License) are served from
  `docs/assets/fonts/` rather than Google Fonts, so a visitor's browser makes
  no request to Google. The one script it needs, ical.js, is vendored in
  `docs/assets/vendor/` (unmodified, with its licence and a record of where
  it came from - see the README there) rather than loaded from a CDN. The page
  makes no request to any other host, and `tests/test_public_site.py` fails if
  that changes.
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

## Testing

`tests/test_build_ics.py` covers the trickiest logic in `build_ics.py` -
title classification, closure-date detection, the recurrence/DST fix, and
the URL sanitizer. Not a full suite (this is a personal project), just
enough to catch a regression in the parts that are genuinely easy to get
subtly wrong.

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```

`scripts/check_config_sync.py` separately checks that the 14 class
codes/labels in `YEAR_GROUPS` haven't drifted from the 3 hand-maintained JS
copies (`tool/functions/api/_shared/calendars.js`, `tool/app.js`,
`docs/assets/calendar.js`) - each has a "keep in sync by hand" comment, and
nothing previously checked that they actually were. Also run automatically
in CI.

Runs automatically on every push/PR via `.github/workflows/test.yml`.

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
