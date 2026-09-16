import { isValidCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateEventInput } from "./_shared/validate.js";
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

  const { calendar, passcode, id, event } = body || {};

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  if (!checkPasscode(env, calendar, passcode)) {
    return jsonResponse({ error: "invalid_passcode" }, 401);
  }
  if (typeof id !== "string" || !id) {
    return jsonResponse({ error: "missing_id" }, 400);
  }
  const validated = validateEventInput(event);
  if (!validated.valid) {
    return jsonResponse({ error: "validation_failed", message: validated.error }, 400);
  }

  try {
    const result = await commitManualEvents(
      env,
      calendar,
      async (current) => {
        const index = current.findIndex((e) => e.id === id);
        if (index === -1) return { error: "not_found" };
        const updated = [...current];
        updated[index] = { id, ...validated.event };
        return { events: updated };
      },
      `Update event in ${calendar}`
    );
    if (result.error) {
      return jsonResponse(result, 404);
    }
    return jsonResponse({ updated: true });
  } catch (err) {
    return jsonResponse({ error: "commit_failed", message: String(err) }, 502);
  }
}
