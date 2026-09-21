import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateEventInput, LIMITS } from "./_shared/validate.js";
import { newPersonalDetails, confirmPublicResponse } from "./_shared/personalDetails.js";
import { commitManualEvents, dedupeKey, generateEventId, triggerRebuild } from "./_shared/github.js";
import { commitErrorResponse, resultStatus } from "./_shared/errors.js";

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
  if (isWholeSchoolCalendar(calendar)) {
    return jsonResponse(
      { error: "not_allowed", message: "Whole School events can't be added here - only their description and location can be edited." },
      403
    );
  }
  if (!Array.isArray(events) || events.length === 0) {
    return jsonResponse({ error: "no_events" }, 400);
  }
  if (events.length > LIMITS.eventsPerSave) {
    return jsonResponse(
      { error: "too_many_events", message: `Save at most ${LIMITS.eventsPerSave} events at a time.` },
      400
    );
  }

  // An event flagged `year_group` is for every class in this calendar's year
  // (e.g. RR and RGP): it's stored once, in the year's shared file, rather
  // than copied into each class's own. The flag is a request field only -
  // validateEventInput() drops it, so it's never written into the event.
  const group = yearGroupFor(calendar);
  const own = [];
  const shared = [];
  const errors = [];
  const checked = [];
  events.forEach((event, index) => {
    const result = validateEventInput(event);
    if (result.valid) checked.push({ index, event: result.event });
    if (!result.valid) {
      errors.push({ index, error: result.error });
    } else if (event && event.year_group === true) {
      if (group) {
        shared.push(result.event);
      } else {
        errors.push({ index, error: "Only a class calendar can add an event for its whole year" });
      }
    } else {
      own.push(result.event);
    }
  });
  if (errors.length > 0) {
    // `message` is what the tool shows the rep; `errors` keeps the detail per event.
    const message = errors
      .map(({ index, error }) => (events.length > 1 ? `Event ${index + 1}: ${error}` : error))
      .join(". ");
    return jsonResponse({ error: "validation_failed", message, errors }, 400);
  }

  // Looks like personal contact details (a mobile number, a personal email...)?
  // Ask the rep to confirm before anything is written: this is public and
  // permanent. Only a warning - the tool re-sends with confirm_public: true.
  if (body.confirm_public !== true) {
    const findings = checked.flatMap(({ index, event }) => newPersonalDetails(event).map((f) => ({ ...f, index })));
    if (findings.length > 0) {
      const prefix = (f) => (events.length > 1 ? `Event ${f.index + 1}: ` : "");
      return jsonResponse(confirmPublicResponse(findings, prefix), 409);
    }
  }

  // Each batch is its own commit. If the second fails after the first
  // succeeded the rep just retries: whatever already saved is skipped as a
  // duplicate (same file + title + date), so nothing is doubled.
  const batches = [
    { file: calendar, events: own },
    ...(group ? [{ file: group.key, events: shared }] : []),
  ].filter((batch) => batch.events.length > 0);

  let saved = 0;
  let skippedDuplicates = 0;
  let commitSha;
  try {
    for (const batch of batches) {
      const result = await appendEvents(env, batch.file, batch.events);
      // e.g. a file with no room left. Whatever an earlier batch already saved
      // stays saved (a retry skips it as a duplicate).
      if (result.error) return jsonResponse(result, resultStatus(result));
      saved += result.saved;
      skippedDuplicates += result.skippedDuplicates;
      commitSha = result.commitSha || commitSha;
    }
  } catch (err) {
    return jsonResponse(commitErrorResponse(err), 502);
  }

  // Every event a duplicate -> nothing appended, nothing new to publish.
  const rebuildTriggered = saved > 0 ? await triggerRebuild(env) : false;
  return jsonResponse({
    saved,
    skipped_duplicates: skippedDuplicates,
    commit_sha: commitSha,
    rebuild_triggered: rebuildTriggered,
  });
}

// Appends `validated` events to one data/manual_events/<file>.json, skipping
// any that duplicate an event already in it (same file + title + date).
async function appendEvents(env, file, validated) {
  const newKeys = await Promise.all(validated.map((e) => dedupeKey(file, e.title, e.date)));
  return commitManualEvents(
    env,
    file,
    async (current) => {
      const currentKeys = new Set(await Promise.all(current.map((e) => dedupeKey(file, e.title, e.date))));
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
    `Add event(s) to ${file}`
  );
}
