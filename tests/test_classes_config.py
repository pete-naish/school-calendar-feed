"""Checks on the live class list, docs/classes.json - the single source of
truth for class codes and labels, read by scripts/build_ics.py, the parent
page and the class rep tool.

The other tests run against a frozen copy (tests/fixtures/classes.json, see
conftest.py) so that relabelling a class never means editing them. These
tests are what keep that safe: the live file has to be well-formed, and its
permanent codes have to match the frozen copy's exactly - labels are free to
change, codes never are (they're feed URLs, passcode keys and data files).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE = json.loads((ROOT / "docs" / "classes.json").read_text())
FROZEN = json.loads((ROOT / "tests" / "fixtures" / "classes.json").read_text())
PAGE_JS = (ROOT / "docs" / "assets" / "calendar.js").read_text()


def _codes(config):
    return [(g["key"], [c["code"] for c in g["classes"]]) for g in config["yearGroups"]]


def test_the_permanent_codes_never_change():
    assert _codes(LIVE) == _codes(FROZEN), (
        "A class code changed. Codes are feed URLs, passcode keys and data file names - "
        "relabel a class by changing its label, never its code."
    )


def test_year_group_keys_labels_and_numbers_are_unchanged():
    strip = lambda config: [(g["key"], g["label"], g["number"]) for g in config["yearGroups"]]
    assert strip(LIVE) == strip(FROZEN)


def test_every_label_is_a_plausible_school_label_for_its_year():
    """A label has to start with its year's number (or R) - that's how
    build_ics.py still routes an event whose label it doesn't recognise."""
    for group in LIVE["yearGroups"]:
        for cls in group["classes"]:
            label = cls["label"]
            assert re.fullmatch(r"[A-Z0-9]+", label), f"{cls['code']}: {label!r} should be capitals/digits only"
            assert label.startswith(group["number"]), f"{cls['code']}: {label!r} should start with {group['number']}"


def test_labels_are_unique_and_never_look_like_a_code():
    labels = [cls["label"] for g in LIVE["yearGroups"] for cls in g["classes"]]
    assert len(labels) == len(set(labels)), f"duplicate labels: {labels}"
    codes = {cls["code"].upper() for g in LIVE["yearGroups"] for cls in g["classes"]}
    assert not codes & set(labels)


def test_the_parent_page_has_a_colour_for_every_year_group():
    styles = re.search(r"const GROUP_STYLES = \{(.*?)\n\};", PAGE_JS, re.S)
    assert styles, "GROUP_STYLES not found in calendar.js"
    styled = set(re.findall(r"^\s*(\w+): \{", styles.group(1), re.M))
    assert styled == {g["key"] for g in LIVE["yearGroups"]}


def test_no_copy_of_the_class_list_is_left_in_code():
    """The four hand-kept copies this file replaced must not creep back."""
    for path in ["docs/assets/calendar.js", "tool/app.js", "tool/functions/api/_shared/calendars.js", "scripts/build_ics.py"]:
        source = (ROOT / path).read_text()
        assert not re.search(r"""["']y\d-[ab]["']\s*,\s*["']?(label|current_label)""", source), path
        assert not re.search(r"""code["']?:\s*["']y\d-[ab]["']\s*,\s*["']?(current_)?label""", source), path
