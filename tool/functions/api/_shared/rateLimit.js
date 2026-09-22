// Policy and helpers for the per-(calendar, source) passcode attempt limit in
// auth.js. There's no rate limiting available at Cloudflare's edge for this
// project (see tool/README.md's "Rate limiting" section for why), so this is
// built in instead: env.RATE_LIMITS (a Workers KV binding) slows guessing a
// calendar's passcode to well below network speed.
//
// It's a soft, best-effort throttle, not an exact one - Workers KV has no
// atomic increment, so a genuine burst of concurrent requests from the same
// source can lose an increment or two - and it fails open (never blocks)
// wherever the KV binding or a usable client IP isn't available, rather than
// locking reps out over an infrastructure gap.
export const RATE_LIMIT = {
  maxAttempts: 10,
  windowSeconds: 15 * 60,
};

// The request's real client IP, as Cloudflare sets it - a client can't spoof
// this header, since Cloudflare overwrites it at its own edge before the
// request reaches this Worker. "unknown" when there's no request (a direct
// unit test of checkPasscode()) or the header is missing (e.g. running
// outside Cloudflare's network, as `wrangler pages dev` does locally) - every
// such caller then shares one bucket per calendar, which only ever makes the
// throttle broader, never a way to bypass it.
export function clientIp(request) {
  return (request && request.headers && request.headers.get("CF-Connecting-IP")) || "unknown";
}

export function rateLimitKey(calendar, ip) {
  return `attempts:${calendar}:${ip}`;
}
