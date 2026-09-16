import { isValidCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { commitManualEvents } from "./_shared/github.js";

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

  const { calendar, passcode, id } = body || {};

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  if (!checkPasscode(env, calendar, passcode)) {
    return jsonResponse({ error: "invalid_passcode" }, 401);
  }
  if (typeof id !== "string" || !id) {
    return jsonResponse({ error: "missing_id" }, 400);
  }

  try {
    const result = await commitManualEvents(
      env,
      calendar,
      async (current) => {
        const index = current.findIndex((e) => e.id === id);
        if (index === -1) return { error: "not_found" };
        const updated = current.filter((e) => e.id !== id);
        return { events: updated };
      },
      `Remove event from ${calendar}`
    );
    if (result.error) {
      return jsonResponse(result, 404);
    }
    return jsonResponse({ deleted: true });
  } catch (err) {
    return jsonResponse({ error: "commit_failed", message: String(err) }, 502);
  }
}
