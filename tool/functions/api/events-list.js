import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { getManualEventsFile, getJsonFile, retryable } from "./_shared/github.js";
import { fetchWholeSchoolEvents } from "./_shared/wholeSchool.js";
import { normalizeOverride } from "./_shared/wholeSchoolOverrides.js";
import { readErrorResponse } from "./_shared/errors.js";

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

  if (isWholeSchoolCalendar(calendar)) {
    try {
      const [events, overrides] = await retryable(() =>
        Promise.all([fetchWholeSchoolEvents(), getJsonFile(env, "data/whole_school_overrides.json", {})])
      );
      // A pending override (saved but not yet picked up by the next
      // 6-hourly build) takes precedence over what's currently published,
      // so a rep who just saved doesn't see their own edit vanish.
      const merged = events.map((e) => {
        const override = normalizeOverride(overrides.data[e.id]);
        return {
          ...e,
          description: override.description ?? e.description,
          location: override.location ?? e.location,
        };
      });
      return jsonResponse({ events: merged });
    } catch (err) {
      return jsonResponse(readErrorResponse(err), 502);
    }
  }

  try {
    // A class also lists its year group's shared events (flagged so the tool
    // can show they apply to every class in the year) - the same events, from
    // the same file, its sibling class's rep sees.
    const group = yearGroupFor(calendar);
    const [own, shared] = await retryable(() =>
      Promise.all([getManualEventsFile(env, calendar), group ? getManualEventsFile(env, group.key) : { events: [] }])
    );
    const events = [...own.events, ...shared.events.map((e) => ({ ...e, year_group: true }))];
    const sorted = events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return jsonResponse({ events: sorted });
  } catch (err) {
    return jsonResponse(readErrorResponse(err), 502);
  }
}
