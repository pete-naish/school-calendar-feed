import { isValidCalendar, isDescriptionOnlyCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateEventInput } from "./_shared/validate.js";
import { commitManualEvents, triggerRebuild } from "./_shared/github.js";
import { commitWholeSchoolDescription } from "./_shared/wholeSchoolOverrides.js";
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

  // Whole School only ever allows editing an event's description - no
  // title/date/recurrence/etc, and events themselves aren't stored here at
  // all (they come from the school's own feed), so this is a completely
  // different, much smaller write than the regular manual-event path below.
  if (isDescriptionOnlyCalendar(calendar)) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    try {
      await commitWholeSchoolDescription(env, id, description);
      return jsonResponse({ updated: true, rebuild_triggered: await triggerRebuild(env) });
    } catch (err) {
      return jsonResponse(commitErrorResponse(err), 502);
    }
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
    return jsonResponse({ updated: true, rebuild_triggered: await triggerRebuild(env) });
  } catch (err) {
    return jsonResponse(commitErrorResponse(err), 502);
  }
}
