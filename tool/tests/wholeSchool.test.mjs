// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEvents } from "../functions/api/_shared/wholeSchool.js";

const calendar = (...events) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.map((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"].flat()).flat(), "END:VCALENDAR"].join("\r\n");

const event = (id, ...lines) => [`UID:stpauls-${id}@school-calendar-feed`, `SUMMARY:Event ${id}`, ...lines];

test("a timed event carries its London start and end time (BST)", () => {
  const [e] = extractEvents(calendar(event(859, "DTSTART:20260925T081500Z", "DTEND:20260925T091500Z")));
  assert.equal(e.date, "2026-09-25");
  assert.equal(e.time, "09:15");
  assert.equal(e.end_time, "10:15");
});

test("winter times are GMT", () => {
  const [e] = extractEvents(calendar(event(1, "DTSTART:20261215T140000Z", "DTEND:20261215T150000Z")));
  assert.equal(e.time, "14:00");
  assert.equal(e.end_time, "15:00");
});

test("an all-day event has no times", () => {
  const [e] = extractEvents(calendar(event(863, "DTSTART;VALUE=DATE:20261007", "DTEND;VALUE=DATE:20261008")));
  assert.equal(e.date, "2026-10-07");
  assert.equal(e.time, null);
  assert.equal(e.end_time, null);
});

test("a timed event with no end has a start time only", () => {
  const [e] = extractEvents(calendar(event(2, "DTSTART:20260925T081500Z")));
  assert.equal(e.time, "09:15");
  assert.equal(e.end_time, null);
});

test("an end on a later day isn't shown as a same-day end time", () => {
  const [e] = extractEvents(calendar(event(3, "DTSTART:20260925T170000Z", "DTEND:20260926T090000Z")));
  assert.equal(e.time, "18:00");
  assert.equal(e.end_time, null);
});

test("the date is the London date of the start instant", () => {
  const [e] = extractEvents(calendar(event(4, "DTSTART:20260924T233000Z")));
  assert.equal(e.date, "2026-09-25");
  assert.equal(e.time, "00:30");
});

test("manual (non-school) events are skipped", () => {
  const manual = ["UID:manual-1@school-calendar-feed", "SUMMARY:Manual", "DTSTART:20260925T081500Z"];
  assert.deepEqual(extractEvents(calendar(manual)), []);
});
