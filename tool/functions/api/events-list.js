import { isValidCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { getManualEventsFile } from "./_shared/github.js";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode } = body || {};

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  if (!checkPasscode(env, calendar, passcode)) {
    return jsonResponse({ error: "invalid_passcode" }, 401);
  }

  try {
    const { events } = await getManualEventsFile(env, calendar);
    const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return jsonResponse({ events: sorted });
  } catch (err) {
    return jsonResponse({ error: "list_failed", message: String(err) }, 502);
  }
}
