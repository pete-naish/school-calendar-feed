// Shared passcode gate. CLASS_PASSWORDS is a Cloudflare Pages secret: a JSON
// object mapping calendar code -> passcode, e.g. {"5hp": "...", "fosps": "..."}.
// This is a shared secret (not per-person auth), but it's checked in constant
// time anyway, so how long a guess takes to be refused never says how much of
// it was right.

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

export function checkPasscode(env, calendar, passcode) {
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
