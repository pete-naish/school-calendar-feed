// Run with: node --test tool/tests/
//
// Which events app.js files under "Past events". app.js is a plain browser
// script with no exports, so the helpers are cut out of its real source and
// run here - the code under test is the code that ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const helpers = source.match(/function eventLastDay[\s\S]*?function isPastEvent\(event, today\) \{[\s\S]*?\n\}\n/);
assert.ok(helpers, "the past-event helpers should be in app.js");

const { eventLastDay, isPastEvent } = vm.runInNewContext(`${helpers[0]}; ({ eventLastDay, isPastEvent })`);

const TODAY = "2026-09-23";

test("a single-day event is past the day after, not on the day", () => {
  assert.equal(isPastEvent({ date: "2026-09-22" }, TODAY), true);
  assert.equal(isPastEvent({ date: TODAY }, TODAY), false);
  assert.equal(isPastEvent({ date: "2026-10-01" }, TODAY), false);
});

test("a multi-day event stays upcoming until its last day is over", () => {
  assert.equal(isPastEvent({ date: "2026-09-20", end_date: TODAY }, TODAY), false);
  assert.equal(isPastEvent({ date: "2026-09-20", end_date: "2026-09-22" }, TODAY), true);
});

test("a repeating event stays upcoming until its until date", () => {
  const recurrence = { freq: "WEEKLY", interval: 1, until: "2026-12-16" };
  assert.equal(isPastEvent({ date: "2026-09-02", recurrence }, TODAY), false);
  assert.equal(isPastEvent({ date: "2026-06-03", recurrence: { ...recurrence, until: "2026-07-22" } }, TODAY), true);
});

test("an occurrence moved past the until date keeps the event upcoming", () => {
  const event = {
    date: "2026-06-03",
    recurrence: { freq: "WEEKLY", interval: 1, until: "2026-07-22" },
    exceptions: [
      { date: "2026-07-01", action: "cancelled" },
      { date: "2026-07-22", action: "moved", new_date: "2026-09-30" },
    ],
  };
  assert.equal(eventLastDay(event), "2026-09-30");
  assert.equal(isPastEvent(event, TODAY), false);
});

test("a school event with only a date works", () => {
  assert.equal(isPastEvent({ id: "123", date: "2026-07-10", end_date: undefined, school_event: true }, TODAY), true);
});
