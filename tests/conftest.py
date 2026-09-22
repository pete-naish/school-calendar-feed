"""Point scripts/build_ics.py at a frozen copy of the class list before any
test imports it. The live list, docs/classes.json, changes whenever the school
relabels a class; the tests' literal titles ("5HP Collective Worship") and
prefixes shouldn't have to change with it. tests/test_classes_config.py checks
the live file itself (shape, and that its permanent codes match this copy)."""
import os
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "classes.json"
os.environ["CLASSES_FILE"] = str(FIXTURE)
