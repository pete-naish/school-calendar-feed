// Run with: node --test tool/tests/
//
// Which events the tool files under "Past events" (appHelpers.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLastDay, isPastEvent } from "../appHelpers.ts";

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
