// Run with: node --test tool/tests/
//
// The weekly rep usage counts: keys hold only week, calendar and action;
// endpoints count only what worked, behind the passcode; /api/track takes
// only the page's own actions.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequestPost as save } from "../functions/api/save.ts";
import { onRequestPost as track } from "../functions/api/track.ts";
import { PAGE_ACTIONS, SERVER_ACTIONS, bumpUsage, isoWeek, recordUsage, usageKey } from "../functions/api/_shared/usageStats.ts";
import { FakeKV } from "./fakeKv.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const passwords = JSON.stringify({ "y5-b": "pw", "rec-a": "ra" });
const newEnv = (extra = {}) => ({ GITHUB_TOKEN: "t", CLASS_PASSWORDS: passwords, STATS: new FakeKV(), ...extra });
const post = (handler, env, body) =>
  handler({ request: new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), env });

// --- weeks and keys ---

test("weeks are ISO weeks", () => {
  assert.equal(isoWeek(new Date("2026-10-05T12:00:00Z")), "2026-W41"); // a Monday
  assert.equal(isoWeek(new Date("2026-10-11T12:00:00Z")), "2026-W41"); // that Sunday
  assert.equal(isoWeek(new Date("2026-10-12T12:00:00Z")), "2026-W42");
});

test("the first days of January can belong to the previous year's last week, and late December to next year's first", () => {
  assert.equal(isoWeek(new Date("2027-01-01T12:00:00Z")), "2026-W53"); // a Friday
  assert.equal(isoWeek(new Date("2027-01-04T12:00:00Z")), "2027-W01");
  assert.equal(isoWeek(new Date("2025-12-29T12:00:00Z")), "2026-W01");
});

test("the week is London's: late on a Sunday in BST is still that week", () => {
  // 23:30 BST on Sunday 11 October is 22:30 UTC - and 00:30 BST Monday is
  // still Sunday in UTC, but Monday (the next week) in London.
  assert.equal(isoWeek(new Date("2026-10-11T22:30:00Z")), "2026-W41");
  assert.equal(isoWeek(new Date("2026-10-11T23:30:00Z")), "2026-W42");
});

test("the key holds only week, calendar and action", () => {
  assert.equal(usageKey("rec-a", "parse", new Date("2026-10-05T12:00:00Z")), "usage:2026-W41:rec-a:parse");
});

test("the page's actions are the PageAction type's, and no action is in both lists", () => {
  const types = readFileSync(new URL("../functions/api/_shared/types.d.ts", import.meta.url), "utf8");
  const declared = types.match(/export type PageAction =([^;]+);/)[1].match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(declared.sort(), [...PAGE_ACTIONS].sort());
  assert.equal(SERVER_ACTIONS.filter((a) => PAGE_ACTIONS.includes(a)).length, 0);
});

// --- bumpUsage ---

test("counts add up, zeros are skipped, and unknown actions and calendars aren't stored", async () => {
  const env = newEnv();
  const now = new Date("2026-10-05T12:00:00Z");
  await bumpUsage(env, "rec-a", { save: 1, saved_events: 3, saved_recurring: 0 }, now);
  await bumpUsage(env, "rec-a", { save: 1, saved_events: 2 }, now);
  await bumpUsage(env, "rec-a", { hacked: 5 }, now);
  await bumpUsage(env, "nope", { save: 1 }, now);
  assert.equal(await env.STATS.get("usage:2026-W41:rec-a:save"), "2");
  assert.equal(await env.STATS.get("usage:2026-W41:rec-a:saved_events"), "5");
  assert.equal(env.STATS.size, 2);
});

test("with no STATS binding nothing happens and nothing throws", async () => {
  await bumpUsage({}, "rec-a", { save: 1 });
});

test("a failing KV is logged, never thrown", async () => {
  const realError = console.error;
  console.error = () => {};
  try {
    await bumpUsage({ STATS: { get: async () => { throw new Error("down"); } } }, "rec-a", { save: 1 });
  } finally {
    console.error = realError;
  }
});

test("recordUsage hands the work to waitUntil when there is one", async () => {
  const env = newEnv();
  const handed = [];
  await recordUsage({ env, waitUntil: (p) => handed.push(p) }, "rec-a", { open: 1 });
  assert.equal(handed.length, 1);
  await handed[0];
  assert.equal(await env.STATS.get(usageKey("rec-a", "open")), "1");
});

// --- endpoints count what worked ---

function fakeGitHub(file = []) {
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") return new Response(JSON.stringify({ commit: { sha: "abc" } }), { status: 200 });
    if (String(url).includes("/actions/workflows/")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(file)).toString("base64"), sha: "s" }), { status: 200 });
  };
}

test("a save counts the save, its events, and which were shared or repeating", async () => {
  fakeGitHub();
  const env = newEnv();
  const resp = await post(save, env, {
    calendar: "y5-b",
    passcode: "pw",
    events: [
      { title: "Trip", date: "2026-11-01" },
      { title: "PE", date: "2026-11-02", recurrence: { freq: "WEEKLY", interval: 1, until: "2026-12-14" } },
      { title: "Year 5 assembly", date: "2026-11-03", year_group: true },
    ],
  });
  assert.equal(resp.status, 200);
  const count = async (action) => env.STATS.get(usageKey("y5-b", action));
  assert.equal(await count("save"), "1");
  assert.equal(await count("saved_events"), "3");
  assert.equal(await count("saved_year_shared"), "1");
  assert.equal(await count("saved_recurring"), "1");
  assert.equal(await count("confirm_public"), null);
});

test("a refused save (wrong passcode, or invalid) counts nothing", async () => {
  fakeGitHub();
  const env = newEnv();
  assert.equal((await post(save, env, { calendar: "y5-b", passcode: "nope", events: [{ title: "Trip", date: "2026-11-01" }] })).status, 401);
  assert.equal((await post(save, env, { calendar: "y5-b", passcode: "pw", events: [{ title: "", date: "2026-11-01" }] })).status, 400);
  assert.equal(env.STATS.size, 0);
});

test("a save where everything was already there counts nothing", async () => {
  fakeGitHub([{ id: "a", title: "Trip", date: "2026-11-01" }]);
  const env = newEnv();
  const resp = await post(save, env, { calendar: "y5-b", passcode: "pw", events: [{ title: "Trip", date: "2026-11-01" }] });
  assert.equal((await resp.json()).saved, 0);
  assert.equal(env.STATS.size, 0);
});

// --- /api/track ---

test("track counts a page action with the right passcode", async () => {
  const env = newEnv();
  const resp = await post(track, env, { calendar: "rec-a", passcode: "ra", action: "week_copy" });
  assert.equal(resp.status, 204);
  assert.equal(await env.STATS.get(usageKey("rec-a", "week_copy")), "1");
});

test("track refuses a wrong passcode, a server-side action, an unknown one, or a bad calendar - quietly", async () => {
  const env = newEnv();
  for (const body of [
    { calendar: "rec-a", passcode: "wrong", action: "week_copy" },
    { calendar: "rec-a", passcode: "ra", action: "save" },
    { calendar: "rec-a", passcode: "ra", action: "anything" },
    { calendar: "nope", passcode: "ra", action: "week_copy" },
    {},
  ]) {
    assert.equal((await post(track, env, body)).status, 204, JSON.stringify(body));
  }
  assert.equal(env.STATS.size, 0);
});

test("track ignores invalid JSON and a missing STATS binding", async () => {
  const env = newEnv();
  const resp = await track({ request: new Request("https://x/api", { method: "POST", body: "{nope" }), env });
  assert.equal(resp.status, 204);
  assert.equal(env.STATS.size, 0);
  const none = await post(track, newEnv({ STATS: undefined }), { calendar: "rec-a", passcode: "ra", action: "week_copy" });
  assert.equal(none.status, 204);
});
