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
  PE): saved as `classes: ["rec-a"]` on the exception, absent meaning every
  class. Where the same date has both a year-wide and a class-specific
  exception, the class-specific one wins for that class; two that would clash
  (both year-wide, or sharing a class) are refused.
- `functions/api/*.js` - Cloudflare Pages Functions (file-based routing:
  `functions/api/parse.js` becomes `POST /api/parse`, etc). Each endpoint
  re-validates the calendar code and passcode independently.
  - `calendars.js` - `GET /api/calendars`, the one endpoint without a
    passcode: the year groups and class labels for the page's calendar
    picker, from `docs/classes.js` (class labels are public anyway).
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
    Year 1 (1S and 1T)"**: those events are stored once, in the year's shared
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
  the 14 classes come from `docs/classes.js`, the single source of truth
  shared with `scripts/build_ics.py` and the parent page, bundled in at deploy
  time; FOSPS is fixed; the 16th, `whole-school`, is the restricted entry
  below and isn't mirrored from anywhere, since it has no
  `data/manual_events/` file at all), `auth.js` (passcode check, in constant
  time, and the per-calendar rate limit - see "Rate limiting" below),
  `rateLimit.js` (that limit's policy and its KV key/IP helpers), `github.js`
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
`location`). It also only accepts an id that's in the published `whole-school.ics` (as a
class's school-event edit only accepts one in its own feed), and
`commitWholeSchoolOverride()` refuses anything but a numeric school event id,
so nothing else can become a key in `data/whole_school_overrides.json`.

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

### School events in a class's own calendar

`scripts/build_ics.py` routes some events from the school's Upcoming Events
feed to a class (or both classes of a year group) instead of Whole School,
based on the class/year named in the title. A class's entry lists those too,
alongside its manual events: `events-list.js` reads the class's own
published `.ics` (`fetchClassSchoolEvents` in `_shared/wholeSchool.js`,
keeping only `stpauls-<id>` UIDs and dropping the `"<CODE>: "` title prefix)
and flags each as `school_event`, plus `year_group` when the sibling class's
feed has it too. They render with the same description/location-only card as
Whole School events, with a "From school calendar" badge (and a "shared with
the year" note where relevant), and save through `events-update.js` with
`school_event: true` into the same `data/whole_school_overrides.json` (keyed by
school event id, so a year-wide event's edit reaches both classes). The id
must be in that class's published feed, so a class passcode can't edit some
other class's or a whole-school event. There is no delete: like Whole School
events, their existence is the school's call.

## Weekly list ("What's on this week")

Every calendar entry (Whole School included) has a **What's on this week**
button that builds the Sunday WhatsApp message: the calendar's own events
plus the whole-school ones for one Monday-Sunday week, grouped by day
(`*bold*` day headings, `•` bullets, then location and description). The text
lands in an editable box with a **Copy for WhatsApp** button, and the ‹ ›
arrows step to other weeks. The default week is this one - or, on a Sunday
(London time), the coming one.

`/api/week` (`functions/api/week.js`, logic in `_shared/weekList.js`) reads
the *published* `<calendar>.ics` and `whole-school.ics` rather than the source
JSON, so it shows what parents' calendar apps show - closure days, cancelled
and moved occurrences, and description/location edits are already applied -
but an edit saved just now only appears once the triggered rebuild has
published (a few minutes). `_shared/ics.js` reads only what `build_ics.py`
writes: recurrences are `DAILY`/`WEEKLY`/`MONTHLY` with `INTERVAL` and
`UNTIL`, skipped days are `EXDATE`s, and a moved occurrence is a separate
one-off event, so a week's occurrences are worked out with plain
London-calendar-date arithmetic (no ical.js, no time-zone maths). School
descriptions contain raw HTML, which is stripped. Whole-school events are
marked "— Whole School" in a class's list.

Tests: `node --test "tool/tests/*.test.mjs"` (no dependencies; also run in CI).

## Limits

`_shared/validate.js` (`LIMITS`) caps what one event can hold, so a single save
can't bloat a data file or produce a feed the public page and calendar apps
struggle with. A rep who goes over gets a message saying which limit, and the
form's text boxes stop at the same lengths (`maxlength` in `index.html` - keep
the two in step).

| | Limit |
|---|---|
| Title / location | 200 characters each |
| Description | 2,000 characters (also for a school event's description edit) |
| Link | 2,000 characters |
| Dates | real calendar days, years 2000-2100 |
| A repeat's "repeat until" | at most 400 days after the event's first day (the public page only looks 400 days ahead), and not before it; interval up to 52 |
| A multi-day event | at most 90 days |
| Exceptions on one event | 100 |
| Events in one save | 50 |

Text pasted through Claude that runs over is shortened (with a warning shown
for the rep to check) rather than refused; an over-long repeat or span from
Claude is dropped, also with a warning. Anything a rep types is refused.

Separately, `commitJsonFile()` won't grow a data file past 900 KB
(`MAX_FILE_BYTES` in `_shared/github.js`), and answers 413 "This calendar has
run out of room for events" instead: GitHub's Contents API stops returning a
file's content inline at 1 MB, after which the tool couldn't read that calendar
again. Deleting or shrinking is always allowed, so a full file can be cleaned
up. The limits apply on the way in only - `build_ics.py` builds whatever is
already in the JSON.

## Personal details warning

Everything a rep saves goes on a public calendar and into a public repository,
where it stays in the git history even after the event is deleted. So a mobile
number pasted in from a WhatsApp message deserves a second look. Before saving,
`_shared/personalDetails.js` checks an event's title, description and location
(and a school event's description and location edit) for:

- **UK mobile numbers** (`07...`, `+44 7...`, `(07700) 900123`...). Landlines
  aren't flagged - a venue's or the office's number is meant to be public.
- **Email addresses at personal providers** (gmail, hotmail, outlook, yahoo,
  icloud, btinternet...). An address on an organisation's own domain isn't.
- **WhatsApp group invite links** (anyone holding one can join the group) and
  `wa.me` links (which contain a phone number).

If it finds something, the server answers `409 confirm_public` with a message
naming what it found, and nothing is written. The tool shows that message and
turns the button into **Save anyway**; pressing it sends the same save again
with `confirm_public: true`. Any edit to the text withdraws the confirmation,
since it may now hold something else.

It's a warning, not a rule, so it's deliberately quiet:

- Only a detail the save **adds** counts. Changing the time of an event whose
  description holds a number the rep already confirmed doesn't ask again (it's
  compared with the saved event; for a school event, with what the school
  publishes), and neither does moving or reformatting that number.
- `PUBLIC_CONTACTS` at the top of `personalDetails.js` lists contacts that are
  meant to be public and are never flagged - add the FOSPS mailbox there if it
  is on gmail, say.

It is a safety net, not a guarantee: it doesn't look for names, children or
addresses (that would flag every pub and school hall), and, since the check is
advisory, anyone calling the API can set `confirm_public`.

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
2. Under the project's **Settings → Functions → KV namespace bindings**, add a
   binding named `RATE_LIMITS` (for both Production and Preview), pointing at
   a KV namespace you create or reuse there - see "Rate limiting" below for
   what this is for. Without it the tool still works, just with no throttling
   on wrong passcode guesses.
3. Under the project's **Settings → Environment variables** (as secrets, for
   both Production and Preview), set:
   - `CLASS_PASSWORDS` - a JSON object mapping each of the 16 calendar codes
     (`rec-a`, `rec-b`, `y1-a` ... `y6-b`, `fosps`, `whole-school`) to a
     passcode you choose (see `.dev.vars.example` for the shape). A class's code
     is a permanent slot, not its current label, so a class that changes
     teacher keeps its key and its passcode: reps still pick their class by
     label in the tool.
   - `ANTHROPIC_API_KEY` - an Anthropic API key.
   - `GITHUB_TOKEN` - a fine-grained GitHub PAT, scoped to only this repo,
     with **Contents: Read and write** and **Actions: Read and write**
     permissions (Actions is what lets a save trigger a rebuild, see
     "Publishing changes"). Create one at
     [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens).
4. Deploy. The tool will be live at the Pages project's URL (or a custom
   domain, if you attach one).
5. Distribute each calendar's passcode to that class's rep (or FOSPS) - how
   you do this (a shared spreadsheet, individual messages, etc) is up to
   you; the tool has no built-in distribution mechanism. Keep the Whole
   School passcode separately, for whoever's trusted to add descriptions and locations to
   whole-school events (e.g. the school office) - see "Whole School events"
   below.

## Response headers

The tool is for reps, not the public, so it's locked down and kept out of
search results. Cloudflare Pages applies `_headers` to static files only and
never to Functions responses, so there are two places:

- `tool/_headers` - the page, `app.js` and `style.css`: `X-Robots-Tag:
  noindex, nofollow` (a header rather than `robots.txt`, because a crawler that
  `robots.txt` blocks never sees a noindex), `nosniff`, no framing, no
  referrer, and a Content-Security-Policy that allows only the tool's own
  script, stylesheet and API (`default-src 'none'`, nothing inline, no `eval`,
  no other origin).
- `functions/api/_middleware.js` - every `/api/*` response: `Cache-Control:
  no-store`, `nosniff`, `noindex`. It also turns anything an endpoint throws
  (say, an unparseable `CLASS_PASSWORDS`) into a plain JSON 500, logging the
  detail rather than showing it.

The CSP is strict enough that some ordinary changes break the page: a web
font, an inline `<style>` or `style="..."`, a third-party script, an
`onclick=`. `tests/headers.test.mjs` fails if `index.html`, `app.js` or
`style.css` stop fitting it - loosen the policy in `_headers` deliberately, not
to make an error go away. If the tool moves to a custom domain, also turn on
HSTS there (Cloudflare dashboard, SSL/TLS, Edge Certificates).

## Rate limiting

Every endpoint that checks a passcode (`checkPasscode()` in `_shared/auth.js`)
enforces a limit on wrong guesses via `env.RATE_LIMITS`, a Workers KV binding:
10 wrong guesses for one calendar from one source within 15 minutes
(`RATE_LIMIT` in `_shared/rateLimit.js`) gets a `429 rate_limited` instead of
being checked at all - even the *right* passcode is refused until the lockout
clears, rather than letting a lucky late guess through. A correct guess before
the limit clears the count, so an occasional typo costs a rep nothing. The
limit is per (calendar, source): hammering one calendar's passcode doesn't
lock a different class's rep out, and doesn't affect a different source
guessing the same calendar.

"Source" is the request's `CF-Connecting-IP` header, which a client can't
spoof - Cloudflare overwrites it at its own edge before the request reaches
this Worker. Outside Cloudflare's network (`wrangler pages dev` locally, or
`env.RATE_LIMITS` not bound) it's "unknown" for everyone, which only makes the
throttle broader, never a way past it - see `rateLimit.js`'s comments.

This is a soft, best-effort throttle, not an exact one: Workers KV has no
atomic increment, so a genuine burst of concurrent requests from the same
source can lose an increment or two. Fine for slowing casual/automated
guessing well below network speed, which is the actual goal.

**Set up the KV namespace** (needed for this to do anything - without it,
`checkPasscode()` fails open and behaves exactly as if there were no rate
limiting at all):

- **Production/Preview**: Cloudflare dashboard → the Pages project →
  **Settings → Functions → KV namespace bindings** → add a binding named
  `RATE_LIMITS`, pointing at a KV namespace you create (or reuse) there. Do
  this for both Production and Preview.
- **Local dev**: `npx wrangler pages dev . --kv RATE_LIMITS` (see "Local
  development" below) - an ephemeral, local-only namespace, not shared with
  production.

**What this doesn't cover:** `/api/parse` costs real Anthropic API money per
call, and this only throttles *wrong* passcode guesses - someone who already
has a valid passcode can still call it as often as they like. Set a spend
limit on the Anthropic key in the [Console](https://console.anthropic.com/)
as a backstop.

Separately: make sure the 16 real passcode values you chose aren't
guessable (the placeholder in `.dev.vars.example` is literally
`"changeme"` - obviously don't ship that).

If the tool is ever on a domain whose DNS is fully hosted on Cloudflare (a
zone, not just a CNAME to `*.pages.dev` from elsewhere), Cloudflare's own WAF
rate limiting rules (Security → WAF → Rate limiting rules) are worth adding
too, as a second layer that blocks abusive requests at the edge before they
even reach this code - but they need that zone to exist, which a `CNAME`
record from another DNS host (as `.pages.dev` custom domains often are)
doesn't give you.

## Local development

```bash
cp tool/.dev.vars.example tool/.dev.vars   # then fill in real test values
cd tool && npx wrangler pages dev . --kv RATE_LIMITS
```

This serves the frontend and functions locally (default `http://localhost:8788`).
Run it from inside `tool/`: Pages looks for `functions/` in the directory you
run it from, so `npx wrangler pages dev tool/` from the repo root serves the page
but none of the `/api/*` endpoints (every POST comes back `405`).
`tool/.dev.vars` is gitignored - never commit it. `--kv RATE_LIMITS` binds an
ephemeral, local-only KV namespace for the rate limit (see "Rate limiting"
below) - omit it to run with no rate limiting at all, same as production
without that binding set up. Local dev has no `CF-Connecting-IP` header, so
every request shares one "unknown" bucket per calendar - fine for exercising
the limit, useless for testing per-source isolation (see auth.test.mjs for
that instead). Wrangler persists local KV to `tool/.wrangler/` between runs;
delete that directory to start clean.

To exercise an endpoint directly:

```bash
curl -X POST http://localhost:8788/api/parse \
  -H "content-type: application/json" \
  -d '{"calendar":"y5-a","passcode":"changeme","text":"Collective worship for 5HP next Tuesday at 9am"}'
```
