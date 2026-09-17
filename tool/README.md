# Class rep calendar tool

A small password-protected web app for class reps (and FOSPS) to add, edit,
or remove events on their calendar - without touching git or JSON directly.
It pastes free text (a WhatsApp message, newsletter paragraph, etc.) through
Claude to extract structured events, then commits them straight to this
repo's `data/manual_events/<code>.json` files, which
`scripts/build_ics.py` already merges into the published `.ics` feeds on its
existing 6-hourly schedule.

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
  the tool won't save an open-ended recurring event). These become a
  standard iCalendar `RRULE` in the published `.ics`. Editing or deleting a
  recurring entry acts on the whole series, not a single occurrence - the
  tool doesn't support per-occurrence edits. `scripts/build_ics.py`
  automatically excludes occurrences that fall on inset days, half term, or
  holidays (and weekends, for a daily repeat) - no need to account for term
  dates when picking a repeat schedule.
- `functions/api/*.js` - Cloudflare Pages Functions (file-based routing:
  `functions/api/parse.js` becomes `POST /api/parse`, etc). Each endpoint
  re-validates the calendar code and passcode independently.
  - `parse.js` - calls Claude to extract events from pasted text. Nothing is
    persisted here.
  - `save.js` - bulk-creates the reviewed events (from `parse.js`, or typed
    in manually), skipping any that duplicate an already-saved event
    (same calendar + title + date).
  - `events-list.js` / `events-update.js` / `events-delete.js` - list,
    amend, or remove an already-saved event by its stable `id`.
- `functions/api/_shared/` - `calendars.js` (the 15 valid calendar codes,
  mirrors `YEAR_GROUPS` in `scripts/build_ics.py` - keep them in sync by
  hand), `auth.js` (passcode check), `github.js` (GitHub Contents API
  get/commit, retrying a concurrent-edit conflict, a GitHub 5xx, or a
  network failure), `validate.js` (sanitizes/validates event data from both
  the LLM and the frontend form - including rejecting any `url` that isn't
  http(s), since it's later rendered as a link on the public preview page),
  `errors.js` (turns a caught failure into a message a non-technical rep
  can act on, while the detail still goes to `console.error`).

## Deploying

1. In the Cloudflare dashboard, create a new **Pages** project connected to
   this GitHub repo. Set **root directory** to `tool/`, and leave the build
   command empty (no build step needed).
2. Under the project's **Settings → Environment variables** (as secrets, for
   both Production and Preview), set:
   - `CLASS_PASSWORDS` - a JSON object mapping each of the 15 calendar codes
     to a passcode you choose (see `.dev.vars.example` for the shape).
   - `ANTHROPIC_API_KEY` - an Anthropic API key.
   - `GITHUB_TOKEN` - a fine-grained GitHub PAT, scoped to only this repo,
     with **Contents: Read and write** permission. Create one at
     [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens).
3. Deploy. The tool will be live at the Pages project's URL (or a custom
   domain, if you attach one).
4. Distribute each calendar's passcode to that class's rep (or FOSPS) - how
   you do this (a shared spreadsheet, individual messages, etc) is up to
   you; the tool has no built-in distribution mechanism.

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

Separately: make sure the 15 real passcode values you chose aren't
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
