import { isValidCalendar, isDescriptionOnlyCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { commitManualEvents } from "./_shared/github.js";
import { commitErrorResponse } from "./_shared/errors.js";

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
  // Whole School events aren't stored here at all (they come from the
  // school's own feed) - nothing to delete via this tool.
  if (isDescriptionOnlyCalendar(calendar)) {
    return jsonResponse(
      { error: "not_allowed", message: "Whole School events can't be deleted here - only their description can be edited." },
      403
    );
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
    return jsonResponse(commitErrorResponse(err), 502);
  }
}
