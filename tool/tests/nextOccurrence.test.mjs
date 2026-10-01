// Run with: node --test tool/tests/
// The day the event list shows a repeating event under (appHelpers.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { nextOccurrence } from "../appHelpers.ts";

const weekly = (overrides = {}) => ({
  date: "2026-09-10", // a Thursday
  recurrence: { freq: "WEEKLY", interval: 1, until: "2026-12-17" },
  exceptions: [],
  ...overrides,
});

test("a weekly series that began earlier shows its next day, not its first", () => {
  assert.equal(nextOccurrence(weekly(), "2026-10-01"), "2026-10-01"); // today's a Thursday
  assert.equal(nextOccurrence(weekly(), "2026-10-02"), "2026-10-08");
});

test("a series that hasn't started yet shows its first day", () => {
  assert.equal(nextOccurrence(weekly({ date: "2026-11-05" }), "2026-10-01"), "2026-11-05");
});

test("a cancelled day is skipped, and a moved one counts on the day it moved to", () => {
  const cancelled = weekly({ exceptions: [{ date: "2026-10-08", action: "cancelled" }] });
  assert.equal(nextOccurrence(cancelled, "2026-10-02"), "2026-10-15");
  const moved = weekly({ exceptions: [{ date: "2026-10-08", action: "moved", new_date: "2026-10-06" }] });
  assert.equal(nextOccurrence(moved, "2026-10-02"), "2026-10-06");
});

test("an exception limited to another class doesn't count for this one", () => {
  const event = weekly({ exceptions: [{ date: "2026-10-08", action: "cancelled", classes: ["rec-b"] }] });
  assert.equal(nextOccurrence(event, "2026-10-02", "rec-a"), "2026-10-08");
  assert.equal(nextOccurrence(event, "2026-10-02", "rec-b"), "2026-10-15");
});

test("fortnightly, daily and monthly series step by their own interval", () => {
  assert.equal(nextOccurrence(weekly({ recurrence: { freq: "WEEKLY", interval: 2, until: "2026-12-17" } }), "2026-10-02"), "2026-10-08");
  assert.equal(nextOccurrence(weekly({ recurrence: { freq: "WEEKLY", interval: 2, until: "2026-12-17" } }), "2026-10-09"), "2026-10-22");
  assert.equal(nextOccurrence(weekly({ recurrence: { freq: "DAILY", interval: 1, until: "2026-12-17" } }), "2026-10-02"), "2026-10-02");
  assert.equal(nextOccurrence({ date: "2026-08-31", recurrence: { freq: "MONTHLY", interval: 1, until: "2027-03-01" } }, "2026-10-02"), "2026-10-31");
  // No 31st in November: straight on to December's.
  assert.equal(nextOccurrence({ date: "2026-08-31", recurrence: { freq: "MONTHLY", interval: 1, until: "2027-03-01" } }, "2026-11-01"), "2026-12-31");
});

test("a one-off event, or a series with nothing left, shows its first day", () => {
  assert.equal(nextOccurrence({ date: "2026-10-20" }, "2026-10-01"), "2026-10-20");
  assert.equal(nextOccurrence(weekly(), "2027-01-01"), "2026-09-10");
});
