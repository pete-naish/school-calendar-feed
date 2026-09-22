// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPasscode, passcodeErrorResponse, timingSafeEqual } from "../functions/api/_shared/auth.js";
import { RATE_LIMIT } from "../functions/api/_shared/rateLimit.js";
import { FakeKV } from "./fakeKv.mjs";

const env = { CLASS_PASSWORDS: JSON.stringify({ "y5-b": "correct horse", "rec-a": "pässwörd-🐴", empty: "", num: 12345 }) };
const req = (ip) => new Request("https://x/api", { headers: ip ? { "CF-Connecting-IP": ip } : {} });

test("timingSafeEqual: equal strings match, anything else doesn't", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("pässwörd-🐴", "pässwörd-🐴"), true);
  for (const [a, b] of [
    ["abc", "abd"],
    ["abc", "ab"], // a prefix of the real one
    ["ab", "abc"], // longer than the real one
    ["abc", "abcd"],
    ["abc", ""],
    ["", "abc"],
    ["abc", "ABC"],
    ["a\u0000", "a"], // a trailing NUL isn't the same as the padding
    ["a", "a\u0000\u0000"],
    ["é", "é"], // same-looking text, different bytes
  ]) {
    assert.equal(timingSafeEqual(a, b), false, JSON.stringify([a, b]));
  }
});

// --- checkPasscode without a request (or without env.RATE_LIMITS): rate
// limiting is entirely out of the picture - just the passcode check itself. ---

test("the right passcode for the right calendar is accepted", async () => {
  assert.equal(await checkPasscode(env, "y5-b", "correct horse"), "ok");
  assert.equal(await checkPasscode(env, "rec-a", "pässwörd-🐴"), "ok");
});

test("a wrong, partial, longer, differently-cased or another calendar's passcode is refused", async () => {
  for (const guess of ["wrong", "correct hors", "correct horse!", "Correct Horse", " correct horse", "correct horse "]) {
    assert.equal(await checkPasscode(env, "y5-b", guess), "wrong_passcode", guess);
  }
  assert.equal(await checkPasscode(env, "rec-a", "correct horse"), "wrong_passcode");
});

test("a missing, empty or non-string passcode is refused", async () => {
  for (const guess of [undefined, null, "", 12345, ["correct horse"], { toString: () => "correct horse" }]) {
    assert.equal(await checkPasscode(env, "y5-b", guess), "wrong_passcode", JSON.stringify(guess));
  }
});

test("a calendar with no passcode configured can't be opened, whatever is sent", async () => {
  assert.equal(await checkPasscode(env, "fosps", "anything"), "wrong_passcode"); // not in the secret at all
  assert.equal(await checkPasscode(env, "empty", "anything"), "wrong_passcode"); // configured as ""
  assert.equal(await checkPasscode(env, "empty", ""), "wrong_passcode");
  assert.equal(await checkPasscode(env, "num", "12345"), "wrong_passcode"); // not a string in the secret
  assert.equal(await checkPasscode(env, "__proto__", "anything"), "wrong_passcode");
  assert.equal(await checkPasscode(env, "constructor", "anything"), "wrong_passcode");
});

test("a CLASS_PASSWORDS secret that isn't JSON is an error, not a silent refusal", async () => {
  await assert.rejects(() => checkPasscode({ CLASS_PASSWORDS: "not json" }, "y5-b", "x"), /not valid JSON/);
  await assert.rejects(() => checkPasscode({}, "y5-b", "x"), /not valid JSON/);
});

// --- rate limiting, via a fake KV standing in for env.RATE_LIMITS ---

test("no env.RATE_LIMITS binding: unlimited attempts, exactly the old behaviour", async () => {
  for (let i = 0; i < RATE_LIMIT.maxAttempts + 5; i++) {
    assert.equal(await checkPasscode(env, "y5-b", "wrong", req("1.2.3.4")), "wrong_passcode");
  }
  assert.equal(await checkPasscode(env, "y5-b", "correct horse", req("1.2.3.4")), "ok");
});

test("maxAttempts wrong guesses from one source against one calendar, then rate_limited", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
    assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4")), "wrong_passcode", `attempt ${i + 1}`);
  }
  assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4")), "rate_limited");
  // Blocked even with the *right* passcode now - a lockout, not a "keep guessing until lucky" gap.
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4")), "rate_limited");
});

test("a correct guess before the limit clears the count", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts - 1; i++) {
    await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  }
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4")), "ok");
  // The slate is clean: maxAttempts more wrong guesses are allowed again before another lockout.
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
    assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4")), "wrong_passcode", `attempt ${i + 1}`);
  }
  assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4")), "rate_limited");
});

test("the limit is per calendar: hammering one doesn't block a different one from the same source", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4")), "rate_limited");
  assert.equal(await checkPasscode(withKv, "rec-a", "pässwörd-🐴", req("1.2.3.4")), "ok");
});

test("the limit is per source: another IP against the same calendar is unaffected", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("5.6.7.8")), "ok");
});

test("no CF-Connecting-IP header (e.g. local dev): every such caller shares one bucket, still throttled", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) {
    assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req(null)), "wrong_passcode");
  }
  assert.equal(await checkPasscode(withKv, "y5-b", "wrong", req(null)), "rate_limited");
  // The IP a client claims in the header is never trusted directly - only Cloudflare's own
  // CF-Connecting-IP is read, so an attacker can't spoof a fresh identity this way.
  assert.equal(await checkPasscode(withKv, "y5-b", "wrong", new Request("https://x/api", { headers: { "X-Forwarded-For": "9.9.9.9" } })), "rate_limited");
});

test("a correct passcode never writes to KV when there was nothing to clear", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4"));
  assert.equal(kv.has("attempts:y5-b:1.2.3.4"), false);
});

test("the count is stored with an expiring TTL, refreshed on every wrong guess", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  const puts = [];
  const realPut = kv.put.bind(kv);
  kv.put = (key, value, options) => {
    puts.push({ key, value, options });
    return realPut(key, value, options);
  };
  await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  assert.deepEqual(puts.map((p) => p.value), ["1", "2"]);
  for (const p of puts) assert.equal(p.options.expirationTtl, RATE_LIMIT.windowSeconds);
});

test("a lockout expiring (TTL elapsed) allows guessing again", async () => {
  const kv = new FakeKV();
  const withKv = { ...env, RATE_LIMITS: kv };
  for (let i = 0; i < RATE_LIMIT.maxAttempts; i++) await checkPasscode(withKv, "y5-b", "wrong", req("1.2.3.4"));
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4")), "rate_limited");
  kv.expireAll(); // simulates the KV entry's expirationTtl having elapsed
  assert.equal(await checkPasscode(withKv, "y5-b", "correct horse", req("1.2.3.4")), "ok");
});

test("passcodeErrorResponse: rate_limited is a 429 with a message, wrong_passcode a bare 401", () => {
  const limited = passcodeErrorResponse("rate_limited");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
  assert.match(limited.body.message, /Too many attempts/);

  for (const result of ["wrong_passcode", "anything_else"]) {
    const resp = passcodeErrorResponse(result);
    assert.equal(resp.status, 401);
    assert.deepEqual(resp.body, { error: "invalid_passcode" });
  }
});
