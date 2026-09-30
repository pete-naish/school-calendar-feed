// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { applyCorrections, validateCorrection } from "../functions/api/_shared/schoolEventCorrections.ts";
import { onRequestPost as update } from "../functions/api/events-update.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TODAY = "2026-09-30";
const halfTerm = { id: "874", title: "Half Term", date: "2026-10-27", end_date: "2026-10-31", time: null, end_time: null };
const service = { id: "861", title: "Service", date: "2026-10-07", end_date: "2026-10-07", time: "14:30", end_time: "15:30" };
const note = "Newsletter 25 Sep";

test("an all-day correction needs real dates, in order, and a reason", () => {
  assert.deepEqual(validateCorrection(halfTerm, { start: "2026-10-26", end: "2026-10-30", note }, TODAY), {
    correction: { start: "2026-10-26", end: "2026-10-30", note },
  });
  for (const input of [
    { start: "2026-10-26", end: "2026-10-30", note: "" },
    { start: "2026-10-26", end: "2026-10-30", note: "  ok " },
    { start: "2026-10-26", end: "2026-10-25", note },
    { start: "2026-02-30", end: "2026-10-30", note },
    { start: "2026-10-26T09:00", end: "2026-10-30T10:00", note },
    { start: "2026-09-29", end: "2026-10-30", note },
    { start: "2028-10-26", end: "2028-10-30", note },
    null,
  ]) {
    assert.ok(validateCorrection(halfTerm, input, TODAY).error, JSON.stringify(input));
  }
});

test("a timed correction stays on one day with the end after the start", () => {
  assert.ok(validateCorrection(service, { start: "2026-10-07T14:30", end: "2026-10-07T15:05", note }, TODAY).correction);
  for (const [start, end] of [
    ["2026-10-07T14:30", "2026-10-08T15:05"],
    ["2026-10-07T14:30", "2026-10-07T14:30"],
    ["2026-10-07T25:00", "2026-10-07T26:00"],
    ["2026-10-07", "2026-10-07"],
  ]) {
    assert.ok(validateCorrection(service, { start, end, note }, TODAY).error, `${start} ${end}`);
  }
});

test("past events and multi-day timed events can't be corrected", () => {
  const past = { ...halfTerm, date: "2026-09-01", end_date: "2026-09-02" };
  assert.match(validateCorrection(past, { start: "2026-10-26", end: "2026-10-30", note }, TODAY).error, /already happened/);
  const overnight = { ...service, end_date: "2026-10-08", end_time: null };
  assert.match(validateCorrection(overnight, { start: "2026-10-07T14:30", end: "2026-10-07T15:05", note }, TODAY).error, /ask Pete/);
});

test("applyCorrections shows the corrected dates and what the school says", () => {
  const corrections = {
    874: { start: "2026-10-26", end: "2026-10-30", school_start: "2026-10-27", school_end: "2026-10-31", note },
    861: { end: "2026-10-07T15:05", note: "hand-written" },
  };
  const [ht, svc] = applyCorrections([halfTerm, service], corrections);
  assert.equal(ht.date, "2026-10-26");
  assert.equal(ht.end_date, "2026-10-30");
  assert.deepEqual(ht.correction.school, { date: "2026-10-27", end_date: "2026-10-31", time: null, end_time: null });
  assert.equal(svc.time, "14:30");
  assert.equal(svc.end_time, "15:05");
  assert.equal(svc.correction.school, null);
});

test("applyCorrections ignores a correction of the wrong shape", () => {
  const [ht] = applyCorrections([halfTerm], { 874: { start: "2026-10-26T09:00" } });
  assert.equal(ht, halfTerm);
});

// --- events-update.ts ---------------------------------------------------------

// Dates a couple of months from the real today, since the endpoint checks
// against it: day(n) is n days after the published event's first day.
const firstDay = new Date(Date.now() + 60 * 86400000);
const day = (n) => new Date(firstDay.getTime() + n * 86400000).toISOString().slice(0, 10);

// A fake GitHub holding `stored` as the corrections file, plus a published
// whole-school feed with an all-day event 874 running day(0)-day(4).
// Returns every PUT body.
function fakeSite(stored = {}) {
  const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      puts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ commit: { sha: "abc" } }), { status: 200 });
    }
    if (String(url).includes("/actions/workflows/")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/calendars/whole-school.ics")) {
      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:stpauls-874@school-calendar-feed",
        "SUMMARY:Half Term",
        `DTSTART;VALUE=DATE:${day(0).replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${day(5).replaceAll("-", "")}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      return new Response(ics, { status: 200 });
    }
    const content = String(url).includes("school_event_corrections") ? stored : {};
    return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(content)).toString("base64"), sha: "sha1" }), {
      status: 200,
    });
  };
  return puts;
}

const env = { GITHUB_TOKEN: "t", CLASS_PASSWORDS: JSON.stringify({ "whole-school": "ws" }) };
const correct = (date_correction, id = "874") =>
  update({
    request: new Request("https://x/api", {
      method: "POST",
      body: JSON.stringify({ calendar: "whole-school", passcode: "ws", id, date_correction }),
    }),
    env,
  });
const written = (put) => JSON.parse(Buffer.from(put.content, "base64").toString());

test("a correction records what the school's calendar said", async () => {
  const puts = fakeSite();
  const resp = await correct({ start: day(-1), end: day(3), note });
  assert.equal(resp.status, 200);
  assert.deepEqual(written(puts[0]), {
    874: { start: day(-1), end: day(3), school_start: day(0), school_end: day(4), note, by: "whole-school" },
  });
  assert.match(puts[0].message, /Half Term.*874.*Newsletter 25 Sep/);
});

test("re-correcting keeps the school's original values, not the published corrected ones", async () => {
  const puts = fakeSite({ 874: { start: day(-2), end: day(2), school_start: day(-7), school_end: day(-3), note } });
  await correct({ start: day(-1), end: day(3), note: "Second newsletter" });
  assert.equal(written(puts[0])[874].school_start, day(-7));
});

test("correcting back to the school's dates, or undoing, removes the entry", async () => {
  const existing = { 874: { start: day(-1), end: day(3), school_start: day(0), school_end: day(4), note } };
  let puts = fakeSite(existing);
  await correct({ start: day(0), end: day(4), note: "School was right" });
  assert.deepEqual(written(puts[0]), {});
  puts = fakeSite(existing);
  assert.equal((await correct(null)).status, 200);
  assert.deepEqual(written(puts[0]), {});
});

test("undoing a correction that isn't there is a 404 and writes nothing", async () => {
  const puts = fakeSite();
  assert.equal((await correct(null)).status, 404);
  assert.equal(puts.length, 0);
});

test("an event outside the caller's feed, or an invalid correction, writes nothing", async () => {
  const puts = fakeSite();
  assert.equal((await correct({ start: day(-1), end: day(3), note }, "999")).status, 404);
  assert.equal((await correct({ start: day(-1), end: day(3), note: "" })).status, 400);
  assert.equal(puts.length, 0);
});
