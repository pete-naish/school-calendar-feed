// Run with: node --test tool/tests/
//
// Proves the rate limit works through the real HTTP stack - a real endpoint,
// a real Request with a CF-Connecting-IP header, a real 429 - not just at the
// checkPasscode() unit level (see auth.test.mjs for that).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as eventsList } from "../functions/api/events-list.js";
import { onRequestPost as save } from "../functions/api/save.js";
import { RATE_LIMIT } from "../functions/api/_shared/rateLimit.js";
import { FakeKV } from "./fakeKv.mjs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeSchoolFeeds() {
  globalThis.fetch = async (url) => {
    const ics = ["BEGIN:VCALENDAR", "END:VCALENDAR"].join("\r\n");
    if (String(url).includes("/calendars/")) return new Response(ics, { status: 200 });
    return new Response("{}", { status: 200 });
  };
}

const post = (handler, env, body, ip) =>
  handler({
    request: new Request("https://x/api", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}) },
      body: JSON.stringify(body),
    }),
    env,
  });

test("guessing a real endpoint's passcode past the limit gets a 429, not a 401, with the calendar untouched", async () => {
  fakeSchoolFeeds();
  const env = { CLASS_PASSWORDS: JSON.stringify({ "y5-b": "correct horse" }), RATE_LIMITS: new FakeKV() };
  const body = { calendar: "y5-b", passcode: "wrong" };

  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
    const resp = await post(eventsList, env, body, "203.0.113.5");
    assert.equal(resp.status, 401, `attempt ${i + 1}`);
    assert.deepEqual(await resp.json(), { error: "invalid_passcode" });
  }

  const blocked = await post(eventsList, env, body, "203.0.113.5");
  assert.equal(blocked.status, 429);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.error, "rate_limited");
  assert.match(blockedBody.message, /Too many attempts/);

  // Even the right passcode is refused mid-lockout.
  const stillBlocked = await post(eventsList, env, { calendar: "y5-b", passcode: "correct horse" }, "203.0.113.5");
  assert.equal(stillBlocked.status, 429);
});

test("a save also enforces the limit, and success clears it for later saves", async () => {
  const env = { GITHUB_TOKEN: "t", CLASS_PASSWORDS: JSON.stringify({ "y5-b": "correct horse" }), RATE_LIMITS: new FakeKV() };
  globalThis.fetch = async () => new Response(JSON.stringify({ content: Buffer.from("[]\n").toString("base64"), sha: "s" }), { status: 200 });

  for (let i = 0; i < RATE_LIMIT.maxAttempts - 1; i++) {
    const resp = await post(save, env, { calendar: "y5-b", passcode: "wrong", events: [{ title: "x", date: "2026-10-01" }] }, "198.51.100.9");
    assert.equal(resp.status, 401);
  }
  // One attempt left before lockout - use it correctly, which must succeed and clear the count.
  const ok = await post(save, env, { calendar: "y5-b", passcode: "correct horse", events: [{ title: "x", date: "2026-10-01" }] }, "198.51.100.9");
  assert.equal(ok.status, 200);

  // The count was cleared, so maxAttempts wrong guesses are allowed again before another lockout.
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
    const resp = await post(save, env, { calendar: "y5-b", passcode: "wrong", events: [] }, "198.51.100.9");
    assert.equal(resp.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await post(save, env, { calendar: "y5-b", passcode: "wrong", events: [] }, "198.51.100.9");
  assert.equal(blocked.status, 429);
});

test("an invalid calendar is rejected before rate limiting is even consulted", async () => {
  const kv = new FakeKV();
  const env = { CLASS_PASSWORDS: JSON.stringify({}), RATE_LIMITS: kv };
  const resp = await post(eventsList, env, { calendar: "not-a-real-calendar", passcode: "x" }, "203.0.113.5");
  assert.equal(resp.status, 400);
  assert.deepEqual(await resp.json(), { error: "invalid_calendar" });
  // Nothing was recorded - an attacker can't use a nonsense calendar name to
  // probe or pollute the rate limiter.
  assert.equal(kv.has("attempts:not-a-real-calendar:203.0.113.5"), false);
});
