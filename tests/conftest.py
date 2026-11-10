"""Point scripts/build_ics.py at a frozen copy of the class list before any
test imports it. The live list, docs/classes.js, changes whenever the school
relabels a class; the tests' literal titles ("5HP Collective Worship") and
prefixes shouldn't have to change with it. tests/test_classes_config.py checks
the live file itself (shape, and that its permanent codes match this copy)."""
import os
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "classes.js"
os.environ["CLASSES_FILE"] = str(FIXTURE)


import pytest


@pytest.fixture(autouse=True)
def _event_pages_in_tmp(tmp_path, monkeypatch):
    """Every test that runs main() would otherwise write docs/e/ for real."""
    import build_ics

    monkeypatch.setattr(build_ics, "EVENT_PAGES_DIR", tmp_path / "e")
