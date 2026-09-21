// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateEventInput, validateExtractedEvents } from "../functions/api/_shared/validate.js";

const event = (overrides) => ({ title: "PE", date: "2026-10-01", ...overrides });

// scripts/build_ics.py can't build an event on a date that only has the right
// shape, and one such event stops every calendar publishing.
test("a date with the right shape but no such day is rejected", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29", "2026-10-00"]) {
    const result = validateEventInput(event({ date }));
    assert.equal(result.valid, false, date);
  }
});

test("real dates are accepted, including a leap day", () => {
  for (const date of ["2026-10-01", "2028-02-29", "2026-12-31"]) {
    assert.equal(validateEventInput(event({ date })).valid, true, date);
  }
});

test("an impossible end date is ignored rather than saved", () => {
  const result = validateEventInput(event({ end_date: "2026-02-30" }));
  assert.equal(result.valid, true);
  assert.equal(result.event.end_date, null);
});

test("an impossible repeat-until date leaves the repeat with no end, so it's refused", () => {
  const result = validateEventInput(event({ recurrence: { freq: "WEEKLY", interval: 1, until: "2026-02-30" } }));
  assert.equal(result.valid, false);
});

test("an impossible exception date is dropped, and so is an impossible move destination", () => {
  const result = validateEventInput(
    event({
      recurrence: { freq: "WEEKLY", interval: 1, until: "2026-12-01" },
      exceptions: [
        { date: "2026-02-30", action: "cancelled" },
        { date: "2026-10-08", action: "moved", new_date: "2026-11-31" },
        { date: "2026-10-15", action: "cancelled" },
      ],
    })
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.event.exceptions, [{ date: "2026-10-15", action: "cancelled" }]);
});

test("an extracted event on an impossible date is dropped with a warning", () => {
  const { events, warnings } = validateExtractedEvents({
    events: [
      { title: "Bad", date: "2026-02-30" },
      { title: "Good", date: "2026-10-01" },
    ],
  });
  assert.deepEqual(events.map((e) => e.title), ["Good"]);
  assert.equal(warnings.length, 1);
});

// icalendar refuses to serialise a URL containing CR/LF, which fails the build.
test("a url containing a line break or other control character is dropped", () => {
  for (const url of ["http://example.com/a\r\nX-EVIL:1", "http://example.com/a\nb", "http://example.com/\tb", "http://example.com/\u0000"]) {
    const result = validateEventInput(event({ url }));
    assert.equal(result.valid, true);
    assert.equal(result.event.url, null, JSON.stringify(url));
  }
});

test("ordinary http(s) urls survive, non-http ones don't", () => {
  assert.equal(validateEventInput(event({ url: "  https://example.com/a?b=1  " })).event.url, "https://example.com/a?b=1");
  assert.equal(validateEventInput(event({ url: "javascript:alert(1)" })).event.url, null);
});
