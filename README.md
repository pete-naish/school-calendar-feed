# school-calendar-feed

Turns [St Paul's C of E Primary (Enfield)](https://www.st-pauls.enfield.sch.uk/calendar/?calid=1&pid=3&viewid=1)'s
"Upcoming Events" calendar into a subscribable `.ics` feed, so it shows up
directly in Google/Apple/Outlook calendar and stays up to date automatically
instead of needing to be checked manually.

The school's calendar page is rendered by FullCalendar.js from an
unauthenticated JSON API (`/calendar/api.asp`). `scripts/build_ics.py` queries
that API directly and converts the result into a standard iCalendar file.

## How it works

- `.github/workflows/update-calendar.yml` runs `scripts/build_ics.py` every 6
  hours via GitHub Actions, and commits `docs/calendar.ics` if it changed.
- GitHub Pages serves `docs/` as a static site, so the feed is published at
  `https://pete-naish.github.io/school-calendar-feed/calendar.ics`.
- `docs/index.html` is a small landing page with subscribe instructions/links
  for Google Calendar, Apple Calendar, and Outlook.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/build_ics.py   # writes docs/calendar.ics
```

## One-time setup

In the repo's GitHub Settings → Pages, set **Source: Deploy from a branch**,
branch `main`, folder `/docs`.

## Scope

This covers only what's published on the school's public Upcoming Events page
(inset days, whole-school events, trips, etc). Class-specific information like
weekly PE days isn't published anywhere scrapable, so it isn't included here.

Not affiliated with the school — this just re-publishes the school's own
public event data in a more convenient format.
