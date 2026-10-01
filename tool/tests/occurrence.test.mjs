// Run with: node --test tool/tests/
// The page checks a new exception's date with its own copy of the server's
// isOccurrence(), so a rep hears about a stray date before saving. They must agree.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isOccurrence as pageIsOccurrence } from "../appHelpers.ts";
import { isOccurrence as serverIsOccurrence } from "../functions/api/_shared/validate.ts";

test("the page and the server agree on which days a series repeats on", () => {
  const start = "2026-10-01";
  const series = [
    { freq: "DAILY", interval: 1, until: "2027-03-01" },
    { freq: "DAILY", interval: 3, until: "2027-03-01" },
    { freq: "WEEKLY", interval: 1, until: "2027-03-01" },
    { freq: "WEEKLY", interval: 2, until: "2027-03-01" },
    { freq: "MONTHLY", interval: 1, until: "2027-03-01" },
    { freq: "MONTHLY", interval: 2, until: "2027-03-01" },
  ];
  for (const recurrence of series) {
    for (let i = -10; i < 160; i++) {
      const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
      assert.equal(pageIsOccurrence(date, start, recurrence), serverIsOccurrence(date, start, recurrence), `${recurrence.freq}/${recurrence.interval} ${date}`);
    }
  }
});
