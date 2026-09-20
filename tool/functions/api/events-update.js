import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateEventInput, cleanOptionalLocation } from "./_shared/validate.js";
import { commitEventById, triggerRebuild } from "./_shared/github.js";
import { commitWholeSchoolOverride } from "./_shared/wholeSchoolOverrides.js";
import { commitErrorResponse } from "./_shared/errors.js";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// An exception's `classes` scope only means something on a year group's shared
// event, and only for that year's classes. On a class's own event it's
// redundant (the event is only ever built into that one calendar), so it's
// removed. On a shared one, codes outside the caller's year are dropped, and
// an exception left naming none of them is dropped too rather than silently
// widening into a year-wide one the rep never asked for.
function scopeExceptions(event, calendar, file) {
  const group = file === calendar ? null : yearGroupFor(calendar);
  const allowed = new Set(group ? group.classes.map((cls) => cls.code) : []);
  const exceptions = (event.exceptions || []).flatMap((exc) => {
    if (!exc.classes) return [exc];
    if (!group) {
      const { classes: _redundant, ...unscoped } = exc;
      return [unscoped];
    }
    const classes = exc.classes.filter((code) => allowed.has(code));
    return classes.length > 0 ? [{ ...exc, classes }] : [];
  });
  return { ...event, exceptions };
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

  // Whole School only ever allows editing an event's description and
  // location - no title/date/recurrence/etc, and events themselves aren't
  // stored here at all (they come from the school's own feed), so this is a
  // completely different, much smaller write than the regular manual-event
  // path below. Only the fields present in the request are changed: the
  // tool sends just the ones a rep edited, so leaving the description alone
  // while adding a location doesn't pin it to the school's current text.
  if (isWholeSchoolCalendar(calendar)) {
    const changes = {};
    if (typeof body.description === "string") changes.description = body.description.trim();
    if (typeof body.location === "string") changes.location = cleanOptionalLocation(body.location) ?? "";
    if (Object.keys(changes).length === 0) {
      return jsonResponse({ error: "nothing_to_update", message: "Nothing to save - no description or location given." }, 400);
    }
    try {
      await commitWholeSchoolOverride(env, id, changes);
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
    // The event is in this class's own file or its year group's shared one.
    const result = await commitEventById(
      env,
      calendar,
      async (current, file) => {
        const index = current.findIndex((e) => e.id === id);
        if (index === -1) return { error: "not_found" };
        const updated = [...current];
        updated[index] = { id, ...scopeExceptions(validated.event, calendar, file) };
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
