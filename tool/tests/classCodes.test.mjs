// Run with: node --test tool/tests/
//
// A class's code ("y5-a") is a permanent slot; its label ("5HP") is what the
// school calls it and what event titles are prefixed with. Everything that
// reads or strips a title prefix has to use the label.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ALL_CALENDARS, FOSPS, WHOLE_SCHOOL, YEAR_GROUPS, isValidCalendar, titlePrefixFor, yearGroupFor } from "../functions/api/_shared/calendars.js";
import { fetchClassSchoolEvents } from "../functions/api/_shared/wholeSchool.js";
import { buildWeekText } from "../functions/api/_shared/weekList.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const classes = YEAR_GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, group: g })));

test("every class code is a generic slot, never a label", () => {
  assert.equal(classes.length, 14);
  const labels = new Set(classes.map((c) => c.label.toUpperCase()));
  for (const { code, group } of classes) {
    assert.match(code, /^(rec|y[1-6])-[ab]$/, code);
    assert.equal(labels.has(code.toUpperCase()), false, `${code} must not look like a school label`);
    assert.ok(yearGroupFor(code) === group);
  }
  assert.deepEqual(classes.map((c) => c.code), [
    "rec-a", "rec-b", "y1-a", "y1-b", "y2-a", "y2-b", "y3-a", "y3-b", "y4-a", "y4-b", "y5-a", "y5-b", "y6-a", "y6-b",
  ]);
});

test("only the current codes are valid calendars - the old label-shaped ones are not", () => {
  for (const { code } of classes) assert.equal(isValidCalendar(code), true, code);
  for (const old of ["rr", "rgp", "5hp", "5l", "5m", "6bt", "6l", "6r", "1ms", "3b", "REC-A"]) {
    assert.equal(isValidCalendar(old), false, old);
  }
  assert.equal(isValidCalendar(FOSPS.code) && isValidCalendar(WHOLE_SCHOOL.code), true);
});

test("the title prefix is the label, whatever the code is", () => {
  assert.equal(titlePrefixFor("rec-a"), "RR: ");
  assert.equal(titlePrefixFor("y3-a"), "3B: "); // not "Y3-A: "
  assert.equal(titlePrefixFor("y5-b"), "5M: ");
  assert.equal(titlePrefixFor("y6-a"), "6L: ");
  assert.equal(titlePrefixFor("fosps"), "FOSPS: ");
  assert.equal(titlePrefixFor("nonsense"), "NONSENSE: ");
});

test("relabelling a class changes only its prefix", () => {
  const entry = ALL_CALENDARS.find((c) => c.code === "y5-b");
  const before = entry.label;
  try {
    entry.label = "5XY";
    assert.equal(titlePrefixFor("y5-b"), "5XY: ");
    assert.equal(titlePrefixFor("y5-a"), "5HP: ");
    assert.equal(isValidCalendar("y5-b"), true);
  } finally {
    entry.label = before;
  }
});

const ics = (title) =>
  ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:stpauls-77@school-calendar-feed", `SUMMARY:${title}`, "DTSTART;VALUE=DATE:20261007", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

test("a class's school events have the label prefix taken off (not the code's)", async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(ics("5M: Sports Day"), { status: 200 });
  };
  const [event] = await fetchClassSchoolEvents("y5-b");
  assert.equal(event.title, "Sports Day");
  assert.ok(requested[0].endsWith("/calendars/y5-b.ics"), "the feed is fetched by its permanent code");
});

test("the weekly list strips the label prefix, so a code-shaped prefix would be left in", () => {
  const week = (title) =>
    buildWeekText({ calendarIcs: ics(title), wholeSchoolIcs: ics("x").replace("stpauls-77", "stpauls-78").replace("SUMMARY:x", "SUMMARY:Other"), calendar: "y5-b", weekStart: "2026-10-05" }).text;
  assert.match(week("5M: Sports Day"), /• Sports Day/);
  assert.doesNotMatch(week("5M: Sports Day"), /5M/);
  assert.match(week("Y5-B: Sports Day"), /Y5-B: Sports Day/);
});
