// GET /api/calendars - the year groups and their classes, for app.ts's
// calendar picker. The page can't read docs/classes.js itself (it's outside
// the tool's static root, and the CSP only allows this origin), so this hands
// it the same list the rest of the API uses. No passcode: class labels are
// public, shown on every published feed. `posters` says whether events can
// have posters, so the page only offers them once the bucket is set up.
import { YEAR_GROUPS } from "./_shared/calendars.ts";
import type { Env } from "./_shared/env.ts";

export function onRequestGet({ env }: { env: Env }) {
  return new Response(JSON.stringify({ yearGroups: YEAR_GROUPS, posters: Boolean(env.POSTERS) }), {
    headers: { "content-type": "application/json" },
  });
}
