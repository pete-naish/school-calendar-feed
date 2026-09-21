// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { LIMITS, overrideLengthError, validateEventInput, validateExtractedEvents } from "../functions/api/_shared/validate.js";

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

// --- limits (see LIMITS in validate.js) ---

const isoDaysAfter = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const weekly = (until) => ({ freq: "WEEKLY", interval: 1, until });

test("a title, description, location or link over its limit is rejected with a message naming it", () => {
  const cases = [
    ["title", "x".repeat(LIMITS.title + 1), /Title is too long/],
    ["description", "x".repeat(LIMITS.description + 1), /Description is too long/],
    ["location", "x".repeat(LIMITS.location + 1), /Location is too long/],
    ["url", `https://example.com/${"x".repeat(LIMITS.url)}`, /Link is too long/],
  ];
  for (const [field, value, message] of cases) {
    const result = validateEventInput(event({ [field]: value }));
    assert.equal(result.valid, false, field);
    assert.match(result.error, message);
  }
});

test("values exactly at the limit are accepted", () => {
  const result = validateEventInput(
    event({ title: "x".repeat(LIMITS.title), description: "y".repeat(LIMITS.description), location: "z".repeat(LIMITS.location) })
  );
  assert.equal(result.valid, true);
});

test("a location is measured after whitespace collapses", () => {
  const result = validateEventInput(event({ location: `Hall${" \n ".repeat(LIMITS.location)}Door` }));
  assert.equal(result.valid, true);
  assert.equal(result.event.location, "Hall Door");
});

test("an extracted title, description and location are shortened with a warning, not dropped", () => {
  const { events, warnings } = validateExtractedEvents({
    events: [
      {
        title: "Bake Sale",
        date: "2026-10-01",
        description: "word ".repeat(1000),
        location: "x".repeat(LIMITS.location + 50),
      },
    ],
  });
  assert.equal(events.length, 1);
  assert.ok(events[0].description.length <= LIMITS.description);
  assert.ok(events[0].description.endsWith("…"));
  assert.ok(events[0].location.length <= LIMITS.location);
  assert.equal(warnings.length, 2);
});

test("an extracted title over the limit is shortened too", () => {
  const { events } = validateExtractedEvents({ events: [{ title: "Word ".repeat(100), date: "2026-10-01" }] });
  assert.ok(events[0].title.length <= LIMITS.title);
});

test("more exceptions than the limit is rejected", () => {
  const exceptions = Array.from({ length: LIMITS.exceptions + 1 }, (_, i) => ({ date: isoDaysAfter("2026-10-01", i), action: "cancelled" }));
  const result = validateEventInput(event({ recurrence: { freq: "DAILY", interval: 1, until: "2027-01-01" }, exceptions }));
  assert.equal(result.valid, false);
  assert.match(result.error, /at most 100 exceptions/);
});

test("dates outside the supported years are rejected", () => {
  for (const date of ["9999-12-31", "1999-12-31", "2101-01-01"]) {
    assert.equal(validateEventInput(event({ date })).valid, false, date);
  }
  assert.equal(validateEventInput(event({ date: "2100-12-31" })).valid, true);
  assert.equal(validateEventInput(event({ date: "2000-01-01" })).valid, true);
});

test("a repeat may run for up to the limit, and no further", () => {
  const ok = validateEventInput(event({ recurrence: weekly(isoDaysAfter("2026-10-01", LIMITS.repeatDays)) }));
  assert.equal(ok.valid, true);
  const tooLong = validateEventInput(event({ recurrence: weekly(isoDaysAfter("2026-10-01", LIMITS.repeatDays + 1)) }));
  assert.equal(tooLong.valid, false);
  assert.match(tooLong.error, /at most 400 days/);
});

test("a repeat running to the year 9999 is rejected", () => {
  assert.equal(validateEventInput(event({ recurrence: { freq: "DAILY", interval: 1, until: "9999-12-31" } })).valid, false);
});

test("a repeat that ends before the event starts is rejected", () => {
  const result = validateEventInput(event({ recurrence: weekly("2026-09-01") }));
  assert.equal(result.valid, false);
  assert.match(result.error, /can't be before/);
});

test("a repeat that ends on the event's own day is fine", () => {
  assert.equal(validateEventInput(event({ recurrence: weekly("2026-10-01") })).valid, true);
});

test("a repeat with no end date or an unsupported frequency is refused with its own message", () => {
  assert.match(validateEventInput(event({ recurrence: { freq: "WEEKLY", interval: 1 } })).error, /needs an end date/);
  assert.match(validateEventInput(event({ recurrence: { freq: "YEARLY", interval: 1, until: "2027-01-01" } })).error, /daily, weekly or monthly/);
});

test("no repeat at all is still fine", () => {
  for (const recurrence of [undefined, null, {}]) {
    const result = validateEventInput(event({ recurrence }));
    assert.equal(result.valid, true);
    assert.equal(result.event.recurrence, null);
  }
});

test("a repeat interval over the limit falls back to 1", () => {
  const result = validateEventInput(event({ recurrence: { freq: "WEEKLY", interval: 1_000_000, until: "2026-12-01" } }));
  assert.equal(result.event.recurrence.interval, 1);
  assert.equal(validateEventInput(event({ recurrence: { freq: "WEEKLY", interval: 2, until: "2026-12-01" } })).event.recurrence.interval, 2);
});

test("a multi-day event may last up to the limit, and no longer", () => {
  assert.equal(validateEventInput(event({ end_date: isoDaysAfter("2026-10-01", LIMITS.spanDays) })).valid, true);
  const tooLong = validateEventInput(event({ end_date: isoDaysAfter("2026-10-01", LIMITS.spanDays + 1) }));
  assert.equal(tooLong.valid, false);
  assert.match(tooLong.error, /at most 90 days/);
});

test("an extracted event's over-long span or repeat is ignored with a warning, keeping the event", () => {
  const { events, warnings } = validateExtractedEvents({
    events: [
      { title: "Trip", date: "2026-10-01", end_date: "2030-01-01" },
      { title: "Club", date: "2026-10-01", recurrence: { freq: "WEEKLY", interval: 1, until: "2030-01-01" } },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].end_date, null);
  assert.equal(events[1].recurrence, null);
  assert.equal(warnings.length, 2);
});

test("overrideLengthError checks a school event's description and location", () => {
  assert.equal(overrideLengthError({ description: "ok", location: "Hall" }), null);
  assert.equal(overrideLengthError({}), null);
  assert.match(overrideLengthError({ description: "x".repeat(LIMITS.description + 1) }), /Description is too long/);
  assert.match(overrideLengthError({ location: "x".repeat(LIMITS.location + 1) }), /Location is too long/);
});
