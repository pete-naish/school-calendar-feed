// POST /api/subscribe-click - {calendar, platform}, sent by the public landing
// page as a navigator.sendBeacon() when a parent clicks a subscribe link. Bumps
// that month's counter for the pair in env.STATS (see _shared/clickStats.js
// for what is and isn't stored). No passcode: it reveals nothing and changes
// nothing but a tally.
//
// Always 204, whatever happened: the page never reads the response (a beacon
// can't), so there's nothing to tell it, and that also means no CORS headers
// are needed. A string beacon body is sent as text/plain, which is why this
// parses the body itself rather than expecting application/json.
//
// Like rateLimit.js, it's best-effort - KV has no atomic increment, so two
// clicks landing at once can count as one - and a no-op with no binding.
import { STATS_ORIGIN, clickKey, isValidClick } from "./_shared/clickStats.js";

const noContent = () => new Response(null, { status: 204 });

export async function onRequestPost({ request, env }) {
  if (!env.STATS || request.headers.get("Origin") !== STATS_ORIGIN) return noContent();

  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return noContent();
  }
  const { calendar, platform } = body || {};
  if (!isValidClick(calendar, platform)) return noContent();

  const key = clickKey(calendar, platform);
  const count = Number.parseInt((await env.STATS.get(key)) || "0", 10) || 0;
  await env.STATS.put(key, String(count + 1));
  return noContent();
}
