// Run with: node --test tool/tests/
//
// The anonymous subscribe-click counter: only well-formed beacons from the
// public page count, and nothing about the request is stored beyond the tally.
import { test } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as subscribeClick } from "../functions/api/subscribe-click.ts";
import { onRequestPost as stats } from "../functions/api/stats.ts";
import { STATS_ORIGIN, STATS_START, clickKey, clickTotals, statsMonths } from "../functions/api/_shared/clickStats.ts";
import { usageKey } from "../functions/api/_shared/usageStats.ts";
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

// --- reading them back: the rep tool's Share tab (/api/stats) ---

test("statsMonths runs from the first counted month to now's, across a new year", () => {
  assert.deepEqual(statsMonths(new Date(`${STATS_START}-15T00:00:00Z`)), [STATS_START]);
  assert.deepEqual(statsMonths(new Date("2027-02-03T00:00:00Z")), [
    "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
  ]);
});

test("clickKey takes a month as well as a date", () => {
  assert.equal(clickKey("rec-a", "apple", "2026-10"), "clicks:2026-10:rec-a:apple");
});

test("clickTotals adds up every month and platform for one calendar only", async () => {
  const kv = new FakeKV();
  await kv.put("clicks:2026-09:rec-a:apple", "5");
  await kv.put("clicks:2026-10:rec-a:apple", "2");
  await kv.put("clicks:2026-10:rec-a:google", "3");
  await kv.put("clicks:2026-10:rec-b:google", "40");
  const totals = await clickTotals(kv, "rec-a", new Date("2026-10-05T12:00:00Z"));
  assert.deepEqual(totals, { total: 10, this_month: 5, by_platform: { apple: 7, google: 3, outlook: 0, link: 0 } });
});

const statsEnv = (extra = {}) => ({ CLASS_PASSWORDS: JSON.stringify({ "rec-a": "ra" }), ...extra });
const askStats = (env, body) =>
  stats({ request: new Request("https://x/api/stats", { method: "POST", body: JSON.stringify(body) }), env });

test("/api/stats answers the signed-in calendar's totals, and counts the Share tab being opened", async () => {
  const env = statsEnv({ STATS: new FakeKV() });
  await env.STATS.put(clickKey("rec-a", "google"), "4");
  const resp = await askStats(env, { calendar: "rec-a", passcode: "ra" });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.available, true);
  assert.equal(body.total, 4);
  assert.equal(body.this_month, 4);
  assert.equal(body.by_platform.google, 4);
  assert.equal(await env.STATS.get(usageKey("rec-a", "share_view")), "1");
});

test("/api/stats needs the passcode", async () => {
  const env = statsEnv({ STATS: new FakeKV() });
  assert.equal((await askStats(env, { calendar: "rec-a", passcode: "nope" })).status, 401);
  assert.equal((await askStats(env, { calendar: "nope", passcode: "ra" })).status, 400);
  assert.equal(env.STATS.size, 0);
});

test("/api/stats with no STATS binding says the count isn't available", async () => {
  const body = await (await askStats(statsEnv(), { calendar: "rec-a", passcode: "ra" })).json();
  assert.equal(body.available, false);
  assert.equal(body.total, 0);
});
