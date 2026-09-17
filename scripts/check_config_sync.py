#!/usr/bin/env python3
"""Fails if the 14 class codes (and their current display labels) have
drifted between scripts/build_ics.py's YEAR_GROUPS and its three
hand-maintained JS mirrors - each of those files has its own "keep in sync
by hand" comment, and nothing previously checked that they actually were.

Only compares what's genuinely meant to be identical across all four:
build_ics.py carries extra fields (aliases, year keys) the JS copies don't
need and shouldn't mirror; "whole-school"/"fosps" aren't part of
YEAR_GROUPS in build_ics.py at all (structurally different there), so
they're excluded from the JS-side extraction too rather than flagged as
"extra".

Run: python3 scripts/check_config_sync.py
Wired into CI via .github/workflows/test.yml.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import build_ics  # noqa: E402

CODE_LABEL_RE = re.compile(r'code:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"')
EXCLUDED_CODES = {"fosps", "whole-school"}

JS_SOURCES = [
    "tool/functions/api/_shared/calendars.js",
    "tool/app.js",
    "docs/assets/calendar.js",
]


def python_codes() -> dict[str, str]:
    return {cls["code"].lower(): cls["current_label"] for group in build_ics.YEAR_GROUPS for cls in group["classes"]}


def js_codes(path: Path) -> dict[str, str]:
    text = path.read_text()
    return {
        code.lower(): label for code, label in CODE_LABEL_RE.findall(text) if code.lower() not in EXCLUDED_CODES
    }


def main() -> int:
    canonical = python_codes()
    ok = True

    for rel_path in JS_SOURCES:
        path = REPO_ROOT / rel_path
        found = js_codes(path)
        if found == canonical:
            print(f"OK: {rel_path} matches scripts/build_ics.py ({len(found)} classes)")
            continue

        ok = False
        print(f"MISMATCH in {rel_path}:")
        missing = canonical.keys() - found.keys()
        extra = found.keys() - canonical.keys()
        if missing:
            print(f"  missing codes: {sorted(missing)}")
        if extra:
            print(f"  unexpected codes: {sorted(extra)}")
        for code in sorted(canonical.keys() & found.keys()):
            if canonical[code] != found[code]:
                print(f"  label mismatch for {code!r}: build_ics.py={canonical[code]!r} vs {rel_path}={found[code]!r}")

    if not ok:
        print(
            "\nUpdate the drifted file(s) to match scripts/build_ics.py's YEAR_GROUPS "
            "(code -> lowercase slug, label -> current_label). If build_ics.py is the "
            "one that's actually wrong (e.g. after a real class relabel), fix it there "
            "first - it's the source of truth.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
