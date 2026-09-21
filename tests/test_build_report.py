"""The build report: problems build_ics.py finds are collected (not just
printed), written to a JSON file for scripts/build_report.py to turn into
Markdown, and the update workflow's last step keeps one GitHub issue in step
with them. Nothing here may ever stop the feeds being published."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

import pytest
from icalendar import Calendar

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_ics  # noqa: E402
import build_report  # noqa: E402

WORKFLOW = (ROOT / ".github" / "workflows" / "update-calendar.yml").read_text()

BAD_EVENT = {"id": "bad1", "title": "Bad", "date": "2026-02-30"}
GOOD_EVENT = {"id": "good1", "title": "Good", "date": "2026-10-02"}
SCHOOL_EVENT = {"id": 900, "title": "Sports Day", "start": "2026-10-05", "end": "2026-10-05", "allDay": True, "desc": ""}


@pytest.fixture(autouse=True)
def _clean_problems():
    build_ics.BUILD_PROBLEMS.clear()
    yield
    build_ics.BUILD_PROBLEMS.clear()


def _run_main(tmp_path, monkeypatch, raw_events, manual=None, report=True):
    """main() against a fake school feed and manual event files. Returns the
    report path (which exists only if the build wrote one)."""
    (tmp_path / "manual").mkdir(exist_ok=True)
    for name, events in (manual or {}).items():
        (tmp_path / "manual" / f"{name}.json").write_text(json.dumps(events))
    overrides = tmp_path / "overrides.json"
    overrides.write_text("{}")
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", overrides)
    monkeypatch.setattr(build_ics, "CALENDARS_DIR", tmp_path / "calendars")
    monkeypatch.setattr(build_ics, "MANUAL_EVENTS_DIR", tmp_path / "manual")
    monkeypatch.setattr(build_ics, "fetch_events", lambda: raw_events)
    report_path = tmp_path / "report.json"
    if report:
        monkeypatch.setenv("BUILD_REPORT_PATH", str(report_path))
    else:
        monkeypatch.delenv("BUILD_REPORT_PATH", raising=False)
    build_ics.main()
    return report_path


# --------------------------------------------------------------------------
# build_ics.py collects problems and writes the report
# --------------------------------------------------------------------------


def test_an_unrecognised_class_code_is_recorded_and_still_warned(capsys):
    build_ics.classify_event("Trip for 6Z")
    (problem,) = build_ics.BUILD_PROBLEMS
    assert problem["kind"] == "unrecognised_class_code"
    assert (problem["token"], problem["title"], problem["treated_as"]) == ("6Z", "Trip for 6Z", "Year 6")
    assert "WARNING: unrecognised class code '6Z' in event" in capsys.readouterr().err


def test_known_class_codes_are_not_problems():
    build_ics.classify_event("5HP Class Assembly")
    build_ics.classify_event("Whole School Church Service")
    assert build_ics.BUILD_PROBLEMS == []


def test_a_skipped_manual_event_is_recorded_with_where_and_why():
    build_ics.build_manual_events([BAD_EVENT, GOOD_EVENT], "y5-b", set())
    (problem,) = build_ics.BUILD_PROBLEMS
    assert problem["kind"] == "skipped_manual_event"
    assert problem["calendar"] == "y5-b.ics"
    assert problem["event"] == "bad1"
    assert problem["error"].startswith("ValueError:")


def test_main_writes_the_report_with_problems_and_a_count_per_calendar(tmp_path, monkeypatch):
    path = _run_main(
        tmp_path,
        monkeypatch,
        [SCHOOL_EVENT, {**SCHOOL_EVENT, "id": 901, "title": "Trip for 6Z"}],
        manual={"y5-b": [BAD_EVENT, GOOD_EVENT]},
    )
    report = json.loads(path.read_text())
    kinds = sorted(p["kind"] for p in report["problems"])
    assert kinds == ["skipped_manual_event", "unrecognised_class_code"]
    assert len(report["calendars"]) == 16  # whole school, 14 classes, FOSPS
    assert report["calendars"]["whole-school.ics"] == 1
    assert report["calendars"]["y5-b.ics"] == 1  # the good manual event; the bad one was skipped
    assert report["calendars"]["y6-a.ics"] == 1 and report["calendars"]["y6-b.ics"] == 1  # 6Z -> both Year 6 classes


def test_a_clean_build_reports_no_problems(tmp_path, monkeypatch):
    path = _run_main(tmp_path, monkeypatch, [SCHOOL_EVENT], manual={"y5-b": [GOOD_EVENT]})
    assert json.loads(path.read_text())["problems"] == []


def test_no_report_is_written_unless_asked_for(tmp_path, monkeypatch):
    path = _run_main(tmp_path, monkeypatch, [SCHOOL_EVENT], report=False)
    assert not path.exists()
    assert (tmp_path / "calendars" / "whole-school.ics").exists()


def test_problems_from_one_build_dont_leak_into_the_next(tmp_path, monkeypatch):
    _run_main(tmp_path, monkeypatch, [SCHOOL_EVENT], manual={"y5-b": [BAD_EVENT]})
    path = _run_main(tmp_path, monkeypatch, [SCHOOL_EVENT], manual={"y5-b": [GOOD_EVENT]})
    assert json.loads(path.read_text())["problems"] == []


def test_an_empty_school_feed_is_a_problem(tmp_path, monkeypatch):
    path = _run_main(tmp_path, monkeypatch, [])
    (problem,) = json.loads(path.read_text())["problems"]
    assert problem["kind"] == "school_feed_empty"


def test_an_unwritable_report_path_never_stops_the_feeds_being_published(tmp_path, monkeypatch, capsys):
    (tmp_path / "manual").mkdir()
    overrides = tmp_path / "overrides.json"
    overrides.write_text("{}")
    monkeypatch.setattr(build_ics, "WHOLE_SCHOOL_OVERRIDES_PATH", overrides)
    monkeypatch.setattr(build_ics, "CALENDARS_DIR", tmp_path / "calendars")
    monkeypatch.setattr(build_ics, "MANUAL_EVENTS_DIR", tmp_path / "manual")
    monkeypatch.setattr(build_ics, "fetch_events", lambda: [SCHOOL_EVENT])
    monkeypatch.setenv("BUILD_REPORT_PATH", str(tmp_path / "no-such-dir" / "report.json"))
    build_ics.main()  # must not raise
    assert "couldn't write the build report" in capsys.readouterr().err
    assert len(list((tmp_path / "calendars").glob("*.ics"))) == 16  # whole school, 14 classes, FOSPS


def test_reporting_leaves_the_published_feeds_exactly_as_they_were(tmp_path, monkeypatch):
    """The report is a side channel: same events in, same calendars out."""
    def feed_bodies(directory):
        out = {}
        for f in directory.glob("*.ics"):
            cal = Calendar.from_ical(f.read_bytes())
            out[f.name] = sorted(str(e["uid"]) for e in cal.walk("VEVENT"))
        return out

    with_report = tmp_path / "a"
    without = tmp_path / "b"
    with_report.mkdir()
    without.mkdir()
    _run_main(with_report, monkeypatch, [SCHOOL_EVENT], manual={"y5-b": [BAD_EVENT, GOOD_EVENT]}, report=True)
    _run_main(without, monkeypatch, [SCHOOL_EVENT], manual={"y5-b": [BAD_EVENT, GOOD_EVENT]}, report=False)
    assert feed_bodies(with_report / "calendars") == feed_bodies(without / "calendars")


# --------------------------------------------------------------------------
# build_report.py: Markdown
# --------------------------------------------------------------------------

PROBLEM_REPORT = {
    "problems": [
        {"kind": "skipped_manual_event", "message": "m", "calendar": "y5-b.ics", "event": "bad1", "error": "ValueError: day is out of range"},
        {"kind": "unrecognised_class_code", "message": "m", "token": "6Z", "title": "Trip for 6Z", "treated_as": "Year 6"},
        {"kind": "school_feed_empty", "message": "m"},
        {"kind": "something_new", "message": "a future kind of problem"},
    ],
    "calendars": {"y5-b.ics": 3, "whole-school.ics": 49},
}


def test_render_lists_each_kind_of_problem_with_what_to_do():
    md = build_report.render(PROBLEM_REPORT, run_url="https://github.com/o/r/actions/runs/1")
    assert md.startswith("## Calendar build problems")
    assert "https://github.com/o/r/actions/runs/1" in md
    assert "### Events skipped (1)" in md and "`y5-b.ics`: `bad1` - `ValueError: day is out of range`" in md
    assert "data/manual_events/" in md
    assert "### Unrecognised class codes (1)" in md and "`6Z` in `Trip for 6Z` - treated as `Year 6`" in md
    assert "`YEAR_GROUPS`" in md
    assert "### The school's calendar returned no events" in md
    assert "### Other (1)" in md and "a future kind of problem" in md
    assert "- `whole-school.ics`: 49" in md


def test_render_says_so_when_there_are_no_problems():
    md = build_report.render({"problems": [], "calendars": {"y5-b.ics": 3}})
    assert md.startswith("## Calendar build: no problems")
    assert "### Events skipped" not in md and "Unrecognised" not in md
    assert "- `y5-b.ics`: 3" in md


def test_render_copes_with_an_empty_or_minimal_report():
    assert "no problems" in build_report.render({})
    assert "no problems" in build_report.render({"problems": [], "calendars": {}})


@pytest.mark.parametrize(
    "hostile",
    [
        "@octocat please review",  # would ping a user
        "fixes #1 and closes org/repo#2",  # would link/close issues
        "`` `backticks` ``` inside",  # would break out of a code span
        "line one\nline two\r\n\r\n## a heading",  # would add structure
        "| a | b |\n|---|---|",  # would make a table
        "<script>alert(1)</script> <img src=x onerror=y>",
        "[click](https://evil.example)",
        "x" * 5000,
    ],
)
def test_event_text_cannot_break_out_of_its_code_span(hostile):
    span = build_report.code(hostile)
    assert "\n" not in span and "\r" not in span
    assert len(span) <= 260
    fence = re.match(r"`+", span).group(0)
    inner = span[len(fence) : -len(fence)]
    assert span.endswith(fence)
    # no run of backticks inside the span is as long as the fence that closes it
    assert all(len(run) < len(fence) for run in re.findall(r"`+", inner))


def test_a_hostile_title_stays_inside_code_in_the_rendered_report():
    md = build_report.render(
        {"problems": [{"kind": "unrecognised_class_code", "token": "6Z", "title": "@everyone see #1\n## x", "treated_as": "Year 6"}]}
    )
    line = next(l for l in md.splitlines() if l.startswith("- `6Z`"))
    assert "`@everyone see #1 ## x`" in line
    assert "## x" not in md.replace("`@everyone see #1 ## x`", "")


def test_has_problems_exit_codes(tmp_path):
    with_problems = tmp_path / "a.json"
    with_problems.write_text(json.dumps(PROBLEM_REPORT))
    clean = tmp_path / "b.json"
    clean.write_text(json.dumps({"problems": [], "calendars": {}}))
    assert build_report.main(["--has-problems", str(with_problems)]) == 0
    assert build_report.main(["--has-problems", str(clean)]) == 1


def test_main_prints_markdown_and_links_the_run(tmp_path, monkeypatch, capsys):
    path = tmp_path / "r.json"
    path.write_text(json.dumps(PROBLEM_REPORT))
    monkeypatch.setenv("RUN_URL", "https://example.test/run/9")
    assert build_report.main([str(path)]) == 0
    out = capsys.readouterr().out
    assert "https://example.test/run/9" in out and out.startswith("## Calendar build problems")


# --------------------------------------------------------------------------
# the workflow: structure, and the report step's shell logic against a fake gh
# --------------------------------------------------------------------------


def _step_names():
    return re.findall(r"^      - (?:name: (.+)|uses: (\S+))", WORKFLOW, re.M)


def _step_block(name: str) -> str:
    start = WORKFLOW.index(f"      - name: {name}")
    rest = WORKFLOW[start + 1 :]
    nxt = re.search(r"\n      (?:#[^\n]*\n      )*- ", rest)
    return WORKFLOW[start : start + 1 + (nxt.start() if nxt else len(rest))]


def test_reporting_can_never_block_publishing():
    names = [a or b for a, b in _step_names()]
    assert names.index("Commit and push if changed") < names.index("Report build problems")
    assert names[-1] == "Report build problems"
    block = _step_block("Report build problems")
    assert "continue-on-error: true" in block
    assert "if: always()" in block
    assert "build_report" not in _step_block("Commit and push if changed")
    assert "gh issue" not in _step_block("Build calendar feeds")


def test_the_report_path_is_set_before_the_first_build_and_issues_may_be_written():
    names = [a or b for a, b in _step_names()]
    assert names.index("Choose where the build report goes") < names.index("Build calendar feeds")
    assert 'BUILD_REPORT_PATH=$RUNNER_TEMP/build-report.json" >> "$GITHUB_ENV"' in WORKFLOW
    assert re.search(r"^permissions:\n  contents: write\n(?:  #[^\n]*\n)*  issues: write$", WORKFLOW, re.M)


def _report_step_script() -> str:
    block = _step_block("Report build problems")
    body = block.split("        run: |\n", 1)[1]
    return "\n".join(line[10:] if line.startswith("          ") else line for line in body.splitlines()) + "\n"


FAKE_GH = """#!/bin/bash
# Records every call. `issue list` answers as the real command would after its
# --jq filter: the open "Calendar build problems" issue's number, or nothing.
echo "$*" >> "$FAKE_GH_LOG"
if [ "$1 $2" = "issue list" ]; then
  [ -n "$FAKE_OPEN_ISSUE" ] && echo "$FAKE_OPEN_ISSUE"
  exit 0
fi
while [ $# -gt 0 ]; do
  if [ "$1" = "--body-file" ]; then cat "$2" >> "$FAKE_GH_BODIES"; fi
  shift
done
exit 0
"""


def _run_report_step(tmp_path, report: dict | None, open_issue: str = ""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
    (bin_dir / "python").symlink_to(sys.executable)
    report_path = tmp_path / "build-report.json"
    if report is not None:
        report_path.write_text(json.dumps(report))
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "BUILD_REPORT_PATH": str(report_path),
        "RUNNER_TEMP": str(tmp_path),
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary.md"),
        "RUN_URL": "https://example.test/run/1",
        "FAKE_GH_LOG": str(tmp_path / "gh.log"),
        "FAKE_GH_BODIES": str(tmp_path / "bodies.md"),
        "FAKE_OPEN_ISSUE": open_issue,
    }
    result = subprocess.run(["bash", "-e", "-c", _report_step_script()], cwd=ROOT, env=env, capture_output=True, text=True)
    read = lambda name: (tmp_path / name).read_text() if (tmp_path / name).exists() else ""
    calls = [c for c in read("gh.log").splitlines()]
    return result, calls, read("summary.md"), read("bodies.md")


CLEAN_REPORT = {"problems": [], "calendars": {"y5-b.ics": 2}}


def test_first_problem_opens_one_issue_and_fills_the_summary(tmp_path):
    result, calls, summary, bodies = _run_report_step(tmp_path, PROBLEM_REPORT)
    assert result.returncode == 0, result.stderr
    assert [c.split()[0:2] for c in calls] == [["issue", "list"], ["issue", "create"]]
    assert "--title Calendar build problems" in calls[1]
    assert "### Events skipped (1)" in summary and "https://example.test/run/1" in summary
    assert "### Events skipped (1)" in bodies


def test_further_problems_edit_the_open_issue_instead_of_opening_another(tmp_path):
    result, calls, summary, bodies = _run_report_step(tmp_path, PROBLEM_REPORT, open_issue="7")
    assert result.returncode == 0, result.stderr
    assert [c.split()[0:2] for c in calls] == [["issue", "list"], ["issue", "edit"]]
    assert calls[1].startswith("issue edit 7 --body-file")
    assert "### Events skipped (1)" in bodies


def test_a_clean_build_closes_the_open_issue(tmp_path):
    result, calls, summary, _ = _run_report_step(tmp_path, CLEAN_REPORT, open_issue="7")
    assert result.returncode == 0, result.stderr
    assert [c.split()[0:2] for c in calls] == [["issue", "list"], ["issue", "close"]]
    assert calls[1].startswith("issue close 7 --comment")
    assert "no problems" in summary


def test_a_clean_build_with_no_open_issue_does_nothing(tmp_path):
    result, calls, summary, _ = _run_report_step(tmp_path, CLEAN_REPORT)
    assert result.returncode == 0, result.stderr
    assert [c.split()[0:2] for c in calls] == [["issue", "list"]]
    assert "no problems" in summary


def test_no_report_file_means_no_github_calls_and_no_failure(tmp_path):
    result, calls, summary, _ = _run_report_step(tmp_path, None)
    assert result.returncode == 0
    assert calls == [] and summary == ""
    assert "No build report was written" in result.stdout
