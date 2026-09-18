import { isValidCalendar, isDescriptionOnlyCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateEventInput } from "./_shared/validate.js";
import { commitManualEvents, dedupeKey, generateEventId } from "./_shared/github.js";
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

  const { calendar, passcode, events } = body || {};

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  if (!checkPasscode(env, calendar, passcode)) {
    return jsonResponse({ error: "invalid_passcode" }, 401);
  }
  // Whole School events come entirely from the school's own feed - this
  // tool can only edit an existing one's description (see events-update.js),
  // never add new ones.
  if (isDescriptionOnlyCalendar(calendar)) {
    return jsonResponse(
      { error: "not_allowed", message: "Whole School events can't be added here - only their description can be edited." },
      403
    );
  }
  if (!Array.isArray(events) || events.length === 0) {
    return jsonResponse({ error: "no_events" }, 400);
  }

  const validated = [];
  const errors = [];
  events.forEach((event, index) => {
    const result = validateEventInput(event);
    if (result.valid) {
      validated.push(result.event);
    } else {
      errors.push({ index, error: result.error });
    }
  });
  if (errors.length > 0) {
    return jsonResponse({ error: "validation_failed", errors }, 400);
  }

  const newKeys = await Promise.all(validated.map((e) => dedupeKey(calendar, e.title, e.date)));

  try {
    const result = await commitManualEvents(
      env,
      calendar,
      async (current) => {
        const currentKeys = new Set(
          await Promise.all(current.map((e) => dedupeKey(calendar, e.title, e.date)))
        );
        const toAppend = [];
        let skippedDuplicates = 0;
        validated.forEach((event, index) => {
          const key = newKeys[index];
          if (currentKeys.has(key)) {
            skippedDuplicates += 1;
            return;
          }
          currentKeys.add(key); // guard against duplicates within the same batch too
          toAppend.push({ id: generateEventId(), ...event });
        });
        return { events: [...current, ...toAppend], saved: toAppend.length, skippedDuplicates };
      },
      `Add event(s) to ${calendar}`
    );

    return jsonResponse({ saved: result.saved, skipped_duplicates: result.skippedDuplicates, commit_sha: result.commitSha });
  } catch (err) {
    return jsonResponse(commitErrorResponse(err), 502);
  }
}
