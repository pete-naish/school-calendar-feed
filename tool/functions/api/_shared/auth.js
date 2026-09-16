// Shared passcode gate. CLASS_PASSWORDS is a Cloudflare Pages secret: a JSON
// object mapping calendar code -> passcode, e.g. {"5hp": "...", "fosps": "..."}.
// This is a low-value shared secret (not per-person auth), so a plain string
// comparison is fine - no need for constant-time comparison.
export function checkPasscode(env, calendar, passcode) {
  if (typeof passcode !== "string" || !passcode) return false;
  let passwords;
  try {
    passwords = JSON.parse(env.CLASS_PASSWORDS);
  } catch {
    throw new Error("CLASS_PASSWORDS secret is not valid JSON");
  }
  const expected = passwords[calendar];
  return typeof expected === "string" && expected.length > 0 && expected === passcode;
}
