// Run with: node --test tool/tests/
//
// The anonymous subscribe-click counter: only well-formed beacons from the
// public page count, and nothing about the request is stored beyond the tally.
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as subscribeClick } from "../functions/api/subscribe-click.js";
import { STATS_ORIGIN, clickKey } from "../functions/api/_shared/clickStats.js";
import { FakeKV } from "./fakeKv.mjs";

// As navigator.sendBeacon() sends a string body: text/plain.
const beacon = (env, body, origin = STATS_ORIGIN) =>
  subscribeClick({
    request: new Request("https://x/api/subscribe-click", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", ...(origin ? { Origin: origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  });

test("a click from the public page increments that month's counter for the calendar and platform", async () => {
  const env = { STATS: new FakeKV() };
  for (let i = 0; i < 3; i++) {
    const resp = await beacon(env, { calendar: "rec-a", platform: "apple" });
    assert.equal(resp.status, 204);
  }
  await beacon(env, { calendar: "rec-a", platform: "google" });

  assert.equal(await env.STATS.get(clickKey("rec-a", "apple")), "3");
  assert.equal(await env.STATS.get(clickKey("rec-a", "google")), "1");
});

test("the key holds only month, calendar and platform", () => {
  assert.equal(clickKey("whole-school", "link", new Date("2026-09-23T12:00:00Z")), "clicks:2026-09:whole-school:link");
});

test("unknown calendars and platforms aren't counted", async () => {
  const env = { STATS: new FakeKV() };
  for (const body of [
    { calendar: "nope", platform: "apple" },
    { calendar: "rec-a", platform: "myspace" },
    { calendar: "rec-a" },
    {},
    null,
  ]) {
    assert.equal((await beacon(env, body)).status, 204);
  }
  assert.equal(env.STATS.size, 0);
});

test("a missing or foreign Origin isn't counted", async () => {
  const env = { STATS: new FakeKV() };
  await beacon(env, { calendar: "rec-a", platform: "apple" }, null);
  await beacon(env, { calendar: "rec-a", platform: "apple" }, "https://evil.example");
  assert.equal(env.STATS.size, 0);
});

test("invalid JSON is ignored", async () => {
  const env = { STATS: new FakeKV() };
  assert.equal((await beacon(env, "{not json")).status, 204);
  assert.equal(env.STATS.size, 0);
});

test("with no STATS binding it's a quiet no-op", async () => {
  const resp = await beacon({}, { calendar: "rec-a", platform: "apple" });
  assert.equal(resp.status, 204);
});
