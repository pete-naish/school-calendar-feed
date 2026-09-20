# Class rep calendar tool

A small password-protected web app for class reps (and FOSPS) to add, edit,
or remove events on their calendar - without touching git or JSON directly.
It pastes free text (a WhatsApp message, newsletter paragraph, etc.) through
Claude to extract structured events, then commits them straight to this
repo's `data/manual_events/<code>.json` files, which
`scripts/build_ics.py` already merges into the published `.ics` feeds on its
existing 6-hourly schedule.

A separate **Whole School** calendar entry (its own passcode) offers a much
more restricted mode: editing an already-published whole-school event's
*description* and *location* only - see "Whole School events" below.

No framework, no build step: plain HTML/CSS/JS frontend + plain JS
Cloudflare Pages Functions. Deploys via Cloudflare's zero-build-command git
integration.

## How it works

- `index.html` / `app.js` / `style.css` - the frontend. Calendar picker →
  passcode → paste text → review/edit extracted events → save. A "+ Add an
  event manually" button is always available too - pasting text through
  Claude is optional, not required. A second section lists and lets you
  edit/delete events already saved to that calendar.
- Every event card supports an optional **end date** (for multi-day events -
  DTEND is set to the end of that day) and an optional **repeat** (daily /
  weekly / every 2 weeks / monthly, each requiring a "repeat until" date -
  the tool won't save an open-ended recurring event). Pasting text like "PE
  every Thursday" auto-detects the repeat pattern and pre-fills the card's
  Repeats dropdown (with a suggested "repeat until" - see `parse.js` /
  `termEnd.js` below) - still fully editable before saving, same as a
  manually-set repeat. These become a standard iCalendar `RRULE` in the
  published `.ics`. `scripts/build_ics.py` automatically excludes
  occurrences that fall on inset days, half term, or holidays (and
  weekends, for a daily repeat) - no need to account for term dates when
  picking a repeat schedule.
- A recurring event's card also gets an **Exceptions** section - move or
  cancel a single occurrence (e.g. one week's PE clashes with a church
  service, so just that week moves to Friday) without touching the rest of
  the series. Saved as an `exceptions` array on the event
  (`{date, action: "cancelled"}` or `{date, action: "moved", new_date,
  new_time?, new_end_time?}`); `build_ics.py` turns each into a standard
  iCalendar `EXDATE` on the series plus, for a move, a genuinely separate
  one-off event with its own stable UID. Only available on an
  already-saved event (not a draft/extraction-review card) - there's no
  series yet to override. On an event shared by the whole year (see
  `save.js` below) an exception can be limited to one class with an
  **Applies to** choice (e.g. only RR's class trip clashes with the shared
  PE): saved as `classes: ["rr"]` on the exception, absent meaning every
  class. Where the same date has both a year-wide and a class-specific
  exception, the class-specific one wins for that class; two that would clash
  (both year-wide, or sharing a class) are refused.
- `functions/api/*.js` - Cloudflare Pages Functions (file-based routing:
  `functions/api/parse.js` becomes `POST /api/parse`, etc). Each endpoint
  re-validates the calendar code and passcode independently.
  - `parse.js` - calls Claude to extract events from pasted text. Detects
    an explicitly-stated repeat pattern ("every Thursday", "weekly") and
    sets `recurrence.freq`/`interval` - it's never allowed to guess how
    long a series runs for (`recurrence.until`), so that gets filled in
    separately (see `termEnd.js` below) as a suggestion the rep still
    reviews before saving. Extracted titles come back in Title Case: the model
    is asked for it, and `_shared/titleCase.js` then fixes any lowercase words
    (keeping acronyms, class codes and anything already capitalised as they
    are - it never lowercases an ALL-CAPS title, since it can't tell a shouted
    heading from an acronym). Titles a rep types or edits are left as written.
    Nothing is persisted at this step.
  - `save.js` - bulk-creates the reviewed events (from `parse.js`, or typed
    in manually). On a class calendar a draft can be ticked **"Add to all of
    Year 1 (1MS and 1T)"**: those events are stored once, in the year's shared
    `data/manual_events/<year key>.json` (e.g. `year1.json`), rather than
    copied into each class's file, and `build_ics.py` builds them into every
    class of the year. `events-list.js` shows a class both its own events and
    its year's shared ones (the latter flagged and marked "Shared with ..."
    in the UI), and `events-update.js` / `events-delete.js` look for an
    event's id in the class's own file, then its year's - so any class in the
    year can edit or delete a shared event, for all of them (bar a class-scoped
    exception, which only affects the classes it names), but a class from
    another year can't touch it. Not offered on FOSPS or Whole School. An
    already-saved event can't change scope here (delete and re-add it).
    Duplicates of an already-saved event are skipped
    (same calendar + title + date). Rejected outright for the Whole School
    entry (see below).
  - `events-list.js` / `events-update.js` / `events-delete.js` - list,
    amend, or remove an already-saved event by its stable `id`. For the
    Whole School entry, `events-list.js` and `events-update.js` instead
    read/write a description/location override (see below); `events-delete.js`
    rejects it outright, same as `save.js`.
- `functions/api/_shared/` - `calendars.js` (the 16 valid calendar codes -
  14 classes + FOSPS mirror `YEAR_GROUPS` in `scripts/build_ics.py` and are
  kept in sync by hand; the 16th, `whole-school`, is the restricted entry
  below and isn't mirrored from anywhere, since it has no
  `data/manual_events/` file at all), `auth.js` (passcode check), `github.js`
  (GitHub Contents API get/commit for any JSON file in the repo, retrying a
  concurrent-edit conflict, a GitHub 5xx, or a network failure), `validate.js`
  (sanitizes/validates event data from both the LLM and the frontend form -
  including rejecting any `url` that isn't http(s), since it's later
  rendered as a link on the public preview page), `errors.js` (turns a
  caught failure into a message a non-technical rep can act on, while the
  detail still goes to `console.error`), `termEnd.js` (finds the next "Last
  Day of ... Term" date from the site's own public `whole-school.ics`, by
  splitting it into VEVENT blocks and regex-matching `SUMMARY`/`DTSTART` per
  block - no ICS parser dependency needed. Used only to default a
  newly-detected recurring event's "repeat until"; falls back to a fixed
  ~12-week horizon if the fetch fails or nothing matches), `wholeSchool.js`
  (lists current whole-school events the same way - by reading the
  published `.ics` - rather than re-implementing `build_ics.py`'s
  classification logic in JS), `wholeSchoolOverrides.js` (commits a
  description/location override to `data/whole_school_overrides.json`).

## Whole School events

The **Whole School** entry in the calendar picker is deliberately much more
restricted than every other calendar: it can only edit an already-published
whole-school event's *description* (e.g. adding parking or kit notes to an
inset day) and *location* (the school's feed never has one, so this adds
rather than replaces) - adding, deleting, or editing anything else about an
event (title, date, recurrence, ...) is disabled both in the UI (a simpler
read-mostly card with just description and location boxes - no other
fields, no "Add events" section at all) and re-checked server-side in every
endpoint (`save.js`/`events-delete.js`/`parse.js` reject this calendar
outright; `events-update.js` accepts only a `description` and/or
`location`).

This is a structurally different data source from every other calendar:
whole-school events aren't hand-entered at all (there's no
`data/manual_events/whole-school.json`) - they come straight from the
school's own API on every 6-hourly `scripts/build_ics.py` run.
`events-list.js` lists them by reading the site's own already-published
`whole-school.ics` (`_shared/wholeSchool.js`), recovering each event's
stable id from its `UID` (`stpauls-<id>@school-calendar-feed`) and merging
in any not-yet-published override so a rep sees their own recent edit
immediately rather than the stale pre-edit text. Saved edits are written to
`data/whole_school_overrides.json`
(`{"<school event id>": {"description": "...", "location": "..."}}`, either
key optional; an older bare-string entry is still read as a description) via
`_shared/wholeSchoolOverrides.js`. The tool sends only the fields a rep
actually changed, so adding a location doesn't also pin the description to
the school's current text. Clearing a box back to empty removes that field's
override entirely (a description reverts to whatever the school's own feed
says; a location just disappears) rather than storing `""`, and an entry with
nothing left is dropped. `build_ics.py` applies these on the next build (see
"Publishing changes" below). An
override whose school event has since disappeared from the school's feed
(deleted, or deleted and recreated under a new id) is pruned from the file by
`build_ics.py` on the next build.

## Publishing changes

Every add, edit or delete (in any calendar, including a Whole School
description) commits to the repo and then dispatches the `Update calendar
feed` GitHub Actions workflow (`triggerRebuild()` in `_shared/github.js`), so
the change is in the published `.ics` within a few minutes rather than
waiting for the 6-hourly scheduled run. The dispatch is best-effort: if it
fails (typically the token lacking **Actions: Read and write**), the save
still succeeds, the response carries `rebuild_triggered: false`, the save
confirmation says to expect up to 6 hours, and the scheduled run publishes it
as before. A save where every event was a duplicate doesn't trigger one.

## Deploying

1. In the Cloudflare dashboard, create a new **Pages** project connected to
   this GitHub repo. Set **root directory** to `tool/`, and leave the build
   command empty (no build step needed).
2. Under the project's **Settings → Environment variables** (as secrets, for
   both Production and Preview), set:
   - `CLASS_PASSWORDS` - a JSON object mapping each of the 16 calendar codes
     to a passcode you choose (see `.dev.vars.example` for the shape).
   - `ANTHROPIC_API_KEY` - an Anthropic API key.
   - `GITHUB_TOKEN` - a fine-grained GitHub PAT, scoped to only this repo,
     with **Contents: Read and write** and **Actions: Read and write**
     permissions (Actions is what lets a save trigger a rebuild, see
     "Publishing changes"). Create one at
     [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens).
3. Deploy. The tool will be live at the Pages project's URL (or a custom
   domain, if you attach one).
4. Distribute each calendar's passcode to that class's rep (or FOSPS) - how
   you do this (a shared spreadsheet, individual messages, etc) is up to
   you; the tool has no built-in distribution mechanism. Keep the Whole
   School passcode separately, for whoever's trusted to add descriptions and locations to
   whole-school events (e.g. the school office) - see "Whole School events"
   below.

## Rate limiting (recommended, not built in)

The tool has no rate limiting of its own - the passcode gate has no
attempt-throttling (a weak/guessable passcode is brute-forceable with
nothing to slow it down), and `/api/parse` costs real Anthropic API money
per call, uncapped in aggregate for anyone who has a valid passcode.

This is better solved at Cloudflare's edge than in application code - it's
free on every plan and blocks abusive requests before they even reach the
Worker:

1. Cloudflare dashboard → your account → **Security → WAF → Rate limiting
   rules** (for a Pages project, this lives under the zone your custom
   domain sits on, not the Pages project itself - if you're using the
   default `*.pages.dev` domain with no custom domain attached, rate
   limiting rules aren't available and you'd need to attach a domain first).
2. **Create rule** - match requests where the path starts with `/api/parse`
   (or `/api/` for all endpoints). A sensible starting point: **10 requests
   per minute per IP**, action **Block** (or **Challenge** if you'd rather
   show a CAPTCHA than a hard block).
3. Repeat for `/api/events-list` / `/api/save` / etc if you want passcode
   brute-forcing specifically throttled too - those don't cost API money,
   but nothing stops rapid-fire guessing otherwise.

Separately: make sure the 16 real passcode values you chose aren't
guessable (the placeholder in `.dev.vars.example` is literally
`"changeme"` - obviously don't ship that).

## Local development

```bash
cp tool/.dev.vars.example tool/.dev.vars   # then fill in real test values
npx wrangler pages dev tool/
```

This serves the frontend and functions locally (default `http://localhost:8788`).
`tool/.dev.vars` is gitignored - never commit it.

To exercise an endpoint directly:

```bash
curl -X POST http://localhost:8788/api/parse \
  -H "content-type: application/json" \
  -d '{"calendar":"5hp","passcode":"changeme","text":"Collective worship for 5HP next Tuesday at 9am"}'
```
