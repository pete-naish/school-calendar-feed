#!/usr/bin/env python3
"""Turns the JSON report scripts/build_ics.py writes (when BUILD_REPORT_PATH is
set) into Markdown, for the Actions job summary and the "Calendar build
problems" issue the update workflow keeps up to date.

    python scripts/build_report.py REPORT.json                  Markdown on stdout
    python scripts/build_report.py --has-problems REPORT.json   exit 0 if there
                                                                are problems, 1 if not

Set RUN_URL to link the run that produced it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ISSUE_TITLE = "Calendar build problems"
_MAX_TEXT = 200


def code(value: object) -> str:
    """`value` as an inline code span that is safe whatever it holds. Event
    titles come from the school and from class reps, and end up in a GitHub
    issue: inside a code span an @name or #123 pings and links nobody, and
    markdown, HTML and table syntax stay literal. Line breaks collapse and
    very long text is cut."""
    text = " ".join(str(value).split())
    if len(text) > _MAX_TEXT:
        text = text[: _MAX_TEXT - 1] + "…"
    # A fence one backtick longer than the longest run inside can't be closed early.
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    fence = "`" * (longest + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{fence}{pad}{text}{pad}{fence}"


def has_problems(report: dict) -> bool:
    return bool(report.get("problems"))


def _of_kind(report: dict, kind: str) -> list[dict]:
    return [p for p in report.get("problems", []) if p.get("kind") == kind]


def render(report: dict, run_url: str | None = None) -> str:
    problems = report.get("problems", [])
    lines: list[str] = []
    if problems:
        lines += [f"## {ISSUE_TITLE}", ""]
    else:
        lines += ["## Calendar build: no problems", ""]
    if run_url:
        lines += [f"Latest run: {run_url}", ""]

    feed_empty = _of_kind(report, "school_feed_empty")
    if feed_empty:
        lines += [
            "### The school's calendar returned no events",
            "",
            "Every event that comes from the school is missing from the feeds this build "
            "published. Check the school's calendar API (`API_URL` in `scripts/build_ics.py`) "
            "still works and hasn't changed shape.",
            "",
        ]

    skipped = _of_kind(report, "skipped_manual_event")
    if skipped:
        lines += [
            f"### Events skipped ({len(skipped)})",
            "",
            "These couldn't be built, so they are **missing from the published calendar**. "
            "The rep tool should stop these being saved, so look for a hand-edited file: "
            "fix the event in `data/manual_events/`.",
            "",
        ]
        lines += [f"- {code(p.get('calendar', '?'))}: {code(p.get('event', '?'))} - {code(p.get('error', '?'))}" for p in skipped]
        lines.append("")

    unknown = _of_kind(report, "unrecognised_class_code")
    if unknown:
        lines += [
            f"### Unrecognised class codes ({len(unknown)})",
            "",
            "The school's calendar used a class label the build doesn't know, so the event went to "
            "both classes of that year instead. If it's a real class, set it as that class's "
            "label in `docs/classes.js`.",
            "",
        ]
        lines += [
            f"- {code(p.get('token', '?'))} in {code(p.get('title', '?'))} - treated as {code(p.get('treated_as', '?'))}"
            for p in unknown
        ]
        lines.append("")

    known = {"school_feed_empty", "skipped_manual_event", "unrecognised_class_code"}
    other = [p for p in problems if p.get("kind") not in known]
    if other:
        lines += [f"### Other ({len(other)})", ""]
        lines += [f"- {code(p.get('message', p.get('kind', '?')))}" for p in other]
        lines.append("")

    calendars = report.get("calendars", {})
    if calendars:
        lines += ["### Events per calendar", ""]
        lines += [f"- {code(name)}: {count}" for name, count in sorted(calendars.items())]
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("report", type=Path)
    parser.add_argument("--has-problems", action="store_true", help="print nothing; exit 0 if there are problems, 1 if not")
    args = parser.parse_args(argv)

    report = json.loads(args.report.read_text())
    if args.has_problems:
        return 0 if has_problems(report) else 1
    sys.stdout.write(render(report, os.environ.get("RUN_URL") or None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
