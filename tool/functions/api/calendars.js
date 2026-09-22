// GET /api/calendars - the year groups and their classes, for app.js's
// calendar picker. The page can't read docs/classes.js itself (it's outside
// the tool's static root, and the CSP only allows this origin), so this hands
// it the same list the rest of the API uses. No passcode: class labels are
// public, shown on every published feed.
import { YEAR_GROUPS } from "./_shared/calendars.js";

export function onRequestGet() {
  return new Response(JSON.stringify({ yearGroups: YEAR_GROUPS }), {
    headers: { "content-type": "application/json" },
  });
}
