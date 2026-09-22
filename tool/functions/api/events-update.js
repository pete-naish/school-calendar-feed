import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.js";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.js";
import { validateEventInput, cleanOptionalLocation, overrideLengthError } from "./_shared/validate.js";
import { newPersonalDetails, confirmPublicResponse } from "./_shared/personalDetails.js";
import { commitEventById, triggerRebuild, retryable } from "./_shared/github.js";
import { commitWholeSchoolOverride } from "./_shared/wholeSchoolOverrides.js";
import { fetchClassSchoolEvents, fetchWholeSchoolEvents } from "./_shared/wholeSchool.js";
import { commitErrorResponse, resultStatus } from "./_shared/errors.js";

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

// The description/location fields present in the request, cleaned - only the
// ones a rep edited, so leaving the description alone while adding a location
// doesn't pin it to the school's current text.
function overrideChanges(body) {
  const changes = {};
  if (typeof body.description === "string") changes.description = body.description.trim();
  if (typeof body.location === "string") changes.location = cleanOptionalLocation(body.location) ?? "";
  return changes;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode, id, event } = body || {};
  // The rep has been told the text looks personal and chose to save anyway
  // (see _shared/personalDetails.js).
  const confirmPublic = body && body.confirm_public === true;

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }
  if (typeof id !== "string" || !id) {
    return jsonResponse({ error: "missing_id" }, 400);
  }

  // Whole School only ever allows editing an event's description and
  // location - no title/date/recurrence/etc, and events themselves aren't
  // stored here at all (they come from the school's own feed), so this is a
  // completely different, much smaller write than the regular manual-event
  // path below.
  if (isWholeSchoolCalendar(calendar)) {
    const changes = overrideChanges(body);
    if (Object.keys(changes).length === 0) {
      return jsonResponse({ error: "nothing_to_update", message: "Nothing to save - no description or location given." }, 400);
    }
    const tooLong = overrideLengthError(changes);
    if (tooLong) return jsonResponse({ error: "validation_failed", message: tooLong }, 400);
    try {
      // Only an event in the published whole-school feed can be edited - not
      // an arbitrary id, and not one of a class's own school events.
      const wholeSchoolEvents = await retryable(() => fetchWholeSchoolEvents());
      const published = wholeSchoolEvents.find((e) => e.id === id);
      if (!published) {
        return jsonResponse({ error: "not_found", message: "That event isn't in the whole-school calendar." }, 404);
      }
      // Only what the edit adds counts: a number the school's own text already
      // publishes isn't the rep's to be warned about.
      if (!confirmPublic) {
        const findings = newPersonalDetails(changes, published);
        if (findings.length > 0) return jsonResponse(confirmPublicResponse(findings), 409);
      }
      const result = await commitWholeSchoolOverride(env, id, changes);
      if (result.error) return jsonResponse(result, resultStatus(result));
      return jsonResponse({ updated: true, rebuild_triggered: await triggerRebuild(env) });
    } catch (err) {
      return jsonResponse(commitErrorResponse(err), 502);
    }
  }

  // A school-sourced event listed in a class's own calendar (see
  // events-list.js) gets the same description/location-only edit. Only ids in
  // this class's published feed are accepted, so a class passcode can't be
  // used to rewrite some other class's - or a whole-school - event.
  if (body.school_event === true) {
    const changes = overrideChanges(body);
    if (Object.keys(changes).length === 0) {
      return jsonResponse({ error: "nothing_to_update", message: "Nothing to save - no description or location given." }, 400);
    }
    const tooLong = overrideLengthError(changes);
    if (tooLong) return jsonResponse({ error: "validation_failed", message: tooLong }, 400);
    try {
      const schoolEvents = await retryable(() => fetchClassSchoolEvents(calendar));
      const published = schoolEvents.find((e) => e.id === id);
      if (!published) {
        return jsonResponse({ error: "not_found", message: "That event isn't in this calendar's school events." }, 404);
      }
      if (!confirmPublic) {
        const findings = newPersonalDetails(changes, published);
        if (findings.length > 0) return jsonResponse(confirmPublicResponse(findings), 409);
      }
      const result = await commitWholeSchoolOverride(env, id, changes, `school event in ${calendar}`);
      if (result.error) return jsonResponse(result, resultStatus(result));
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
        // Compared with what's saved now, so only a detail this edit adds
        // needs confirming - not one the rep already saw and accepted.
        if (!confirmPublic) {
          const findings = newPersonalDetails(validated.event, current[index]);
          if (findings.length > 0) return confirmPublicResponse(findings);
        }
        const updated = [...current];
        updated[index] = { id, ...scopeExceptions(validated.event, calendar, file) };
        return { events: updated };
      },
      `Update event in ${calendar}`
    );
    if (result.error) {
      return jsonResponse(result, resultStatus(result));
    }
    return jsonResponse({ updated: true, rebuild_triggered: await triggerRebuild(env) });
  } catch (err) {
    return jsonResponse(commitErrorResponse(err), 502);
  }
}
