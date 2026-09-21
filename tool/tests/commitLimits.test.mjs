// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { commitJsonFile, MAX_FILE_BYTES } from "../functions/api/_shared/github.js";
import { onRequestPost as save } from "../functions/api/save.js";
import { onRequestPost as update } from "../functions/api/events-update.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const b64 = (data) => Buffer.from(`${JSON.stringify(data, null, 2)}\n`).toString("base64");

// The published whole-school feed, holding school event 859 (whole-school edits
// are only accepted for an event in it).
const WHOLE_SCHOOL_ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:stpauls-859@school-calendar-feed",
  "SUMMARY:Inset Day",
  "DTSTART;VALUE=DATE:20261007",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// A fake GitHub holding one JSON file; records every PUT.
function fakeGithub(fileData) {
  const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      puts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ commit: { sha: "abc123" } }), { status: 200 });
    }
    if (String(url).includes("/actions/workflows/")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/calendars/whole-school.ics")) return new Response(WHOLE_SCHOOL_ICS, { status: 200 });
    return new Response(JSON.stringify({ content: b64(fileData), sha: "sha1" }), { status: 200 });
  };
  return puts;
}

const env = { GITHUB_TOKEN: "t", CLASS_PASSWORDS: JSON.stringify({ "y5-b": "pw", "whole-school": "ws" }) };
const post = (handler, body) =>
  handler({ request: new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), env });

// An event whose serialised form is `bytes` long, give or take a few.
const bulky = (bytes) => ({ id: "big", title: "Big", date: "2026-10-01", description: "x".repeat(bytes) });

test("a write that would grow a file past the limit is refused without touching GitHub", async () => {
  const puts = fakeGithub([]);
  const result = await commitJsonFile(env, "data/x.json", [], async () => ({ data: [bulky(MAX_FILE_BYTES)] }), "msg");
  assert.equal(result.error, "file_full");
  assert.match(result.message, /run out of room/);
  assert.equal(puts.length, 0);
});

test("a write that stays under the limit goes through", async () => {
  const puts = fakeGithub([]);
  const result = await commitJsonFile(env, "data/x.json", [], async () => ({ data: [bulky(1000)] }), "msg");
  assert.equal(result.error, undefined);
  assert.equal(puts.length, 1);
});

test("shrinking a file that is already over the limit is still allowed, even if it stays over", async () => {
  // Removing the small event leaves a file that is smaller, but still over.
  const puts = fakeGithub([bulky(MAX_FILE_BYTES + 5000), bulky(100)]);
  const result = await commitJsonFile(env, "data/x.json", [], async (events) => ({ data: events.slice(0, 1) }), "msg");
  assert.equal(result.error, undefined);
  assert.equal(puts.length, 1);
});

test("growing an already over-full file is refused even if the addition is small", async () => {
  const puts = fakeGithub([bulky(MAX_FILE_BYTES + 5000)]);
  const result = await commitJsonFile(env, "data/x.json", [], async (events) => ({ data: [...events, bulky(10)] }), "msg");
  assert.equal(result.error, "file_full");
  assert.equal(puts.length, 0);
});

test("save.js answers 413 with a readable message when the calendar has no room left", async () => {
  fakeGithub([bulky(MAX_FILE_BYTES - 500)]);
  const resp = await post(save, {
    calendar: "y5-b",
    passcode: "pw",
    events: [{ title: "New", date: "2026-10-02", description: "y".repeat(1500) }],
  });
  assert.equal(resp.status, 413);
  assert.match((await resp.json()).message, /run out of room/);
});

test("save.js refuses more events than the per-save limit before touching GitHub", async () => {
  const puts = fakeGithub([]);
  const events = Array.from({ length: 51 }, (_, i) => ({ title: `E${i}`, date: "2026-10-01" }));
  const resp = await post(save, { calendar: "y5-b", passcode: "pw", events });
  assert.equal(resp.status, 400);
  assert.equal((await resp.json()).error, "too_many_events");
  assert.equal(puts.length, 0);
});

test("save.js accepts exactly the per-save limit", async () => {
  fakeGithub([]);
  const events = Array.from({ length: 50 }, (_, i) => ({ title: `E${i}`, date: "2026-10-01" }));
  const resp = await post(save, { calendar: "y5-b", passcode: "pw", events });
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).saved, 50);
});

test("save.js puts a validation problem in `message`, which is what the tool shows", async () => {
  fakeGithub([]);
  const one = await post(save, { calendar: "y5-b", passcode: "pw", events: [{ title: "x".repeat(300), date: "2026-10-01" }] });
  assert.equal(one.status, 400);
  assert.equal((await one.json()).message, "Title is too long (at most 200 characters)");

  const two = await post(save, {
    calendar: "y5-b",
    passcode: "pw",
    events: [
      { title: "Fine", date: "2026-10-01" },
      { title: "Bad", date: "2026-02-30" },
    ],
  });
  const body = await two.json();
  assert.equal(body.message, "Event 2: A valid date (YYYY-MM-DD) is required");
  assert.equal(body.errors.length, 1);
});

test("a whole-school description over the limit is refused before anything is written", async () => {
  const puts = fakeGithub({});
  const resp = await post(update, { calendar: "whole-school", passcode: "ws", id: "859", description: "x".repeat(2001) });
  assert.equal(resp.status, 400);
  assert.match((await resp.json()).message, /Description is too long/);
  assert.equal(puts.length, 0);
});

test("a whole-school description at the limit is saved", async () => {
  const puts = fakeGithub({});
  const resp = await post(update, { calendar: "whole-school", passcode: "ws", id: "859", description: "x".repeat(2000) });
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

test("editing an event into something too big gets 413 rather than a false 'updated'", async () => {
  fakeGithub([{ id: "e1", title: "Old", date: "2026-10-01" }, bulky(MAX_FILE_BYTES - 1500)]);
  const resp = await post(update, {
    calendar: "y5-b",
    passcode: "pw",
    id: "e1",
    event: { title: "Old", date: "2026-10-01", description: "y".repeat(2000) },
  });
  assert.equal(resp.status, 413);
});
