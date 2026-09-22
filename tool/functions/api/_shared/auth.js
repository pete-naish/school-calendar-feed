// Shared passcode gate. CLASS_PASSWORDS is a Cloudflare Pages secret: a JSON
// object mapping calendar code -> passcode, e.g. {"5hp": "...", "fosps": "..."}.
// This is a shared secret (not per-person auth), but it's checked in constant
// time anyway, so how long a guess takes to be refused never says how much of
// it was right.
import { RATE_LIMIT, clientIp, rateLimitKey } from "./rateLimit.js";

// True when the two strings hold the same UTF-8 bytes. Always walks the length
// of the longer one and folds every byte and the length difference into one
// value, rather than stopping at the first mismatch.
export function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const length = Math.max(x.length, y.length);
  const paddedX = new Uint8Array(length);
  const paddedY = new Uint8Array(length);
  paddedX.set(x);
  paddedY.set(y);
  let diff = x.length ^ y.length;
  for (let i = 0; i < length; i++) diff |= paddedX[i] ^ paddedY[i];
  return diff === 0;
}

function passcodeMatches(env, calendar, passcode) {
  if (typeof passcode !== "string" || !passcode) return false;
  let passwords;
  try {
    passwords = JSON.parse(env.CLASS_PASSWORDS);
  } catch {
    throw new Error("CLASS_PASSWORDS secret is not valid JSON");
  }
  const expected = passwords[calendar];
  // Compare even when nothing is configured for this calendar (against ""), so
  // that case takes the same path as a wrong guess.
  const configured = typeof expected === "string" && expected.length > 0;
  return timingSafeEqual(configured ? expected : "", passcode) && configured;
}

// Checks a passcode for `calendar`, also enforcing RATE_LIMIT (see
// rateLimit.js) on wrong guesses via env.RATE_LIMITS - so a weak or guessed
// passcode isn't brute-forceable at network speed. Returns "ok",
// "wrong_passcode", or "rate_limited" (this source has made too many wrong
// guesses against this calendar recently - the passcode itself isn't even
// checked this time).
//
// `request` is where the client IP comes from; it's optional so a direct unit
// test of the passcode check itself doesn't need one (every caller sharing
// "unknown" as their IP only makes the throttle broader, never a way around
// it). Every real endpoint passes its own `request`.
export async function checkPasscode(env, calendar, passcode, request = null) {
  const kv = env.RATE_LIMITS;
  let count = 0;
  if (kv) {
    const raw = await kv.get(rateLimitKey(calendar, clientIp(request)));
    count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= RATE_LIMIT.maxAttempts) return "rate_limited";
  }
  const ok = passcodeMatches(env, calendar, passcode);
  if (kv) {
    const key = rateLimitKey(calendar, clientIp(request));
    if (ok) {
      // A correct guess clears the count, so an occasional typo never costs a
      // legitimate rep anything.
      if (count > 0) await kv.delete(key);
    } else {
      // A wrong guess refreshes the window, so a source that keeps guessing
      // after being blocked stays blocked until it actually stops for a full
      // window - not unblocked on a fixed schedule regardless.
      await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT.windowSeconds });
    }
  }
  return ok ? "ok" : "wrong_passcode";
}

// The response for a checkPasscode() result that wasn't "ok" - shared so
// every endpoint gives the same status and message for the same outcome.
export function passcodeErrorResponse(authResult) {
  if (authResult === "rate_limited") {
    return {
      status: 429,
      body: {
        error: "rate_limited",
        message: "Too many attempts for this calendar - please wait a few minutes and try again.",
      },
    };
  }
  return { status: 401, body: { error: "invalid_passcode" } };
}
