import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.js";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.js";
import { getManualEventsFile, getJsonFile, retryable } from "./_shared/github.js";
import { fetchWholeSchoolEvents, fetchClassSchoolEvents } from "./_shared/wholeSchool.js";
import { applyOverrides } from "./_shared/wholeSchoolOverrides.js";
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
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }

  if (isWholeSchoolCalendar(calendar)) {
    try {
      const [events, overrides] = await retryable(() =>
        Promise.all([fetchWholeSchoolEvents(), getJsonFile(env, "data/whole_school_overrides.json", {})])
      );
      return jsonResponse({ events: applyOverrides(events, overrides.data) });
    } catch (err) {
      return jsonResponse(readErrorResponse(err), 502);
    }
  }

  try {
    // A class also lists its year group's shared events (flagged so the tool
    // can show they apply to every class in the year) - the same events, from
    // the same file, its sibling class's rep sees.
    //
    // It also lists the class's school-sourced events - the ones from the
    // school's Upcoming Events feed that classify_event() routed to this class
    // rather than to Whole School. They're flagged (`school_event`) so the tool
    // shows them as the school's, and (`year_group`) when the sibling class's
    // feed has them too, i.e. they're year-wide and an edit reaches both.
    const group = yearGroupFor(calendar);
    const siblings = group ? group.classes.filter((cls) => cls.code !== calendar) : [];
    const [own, shared, schoolEvents, siblingSchoolEvents, overrides] = await retryable(() =>
      Promise.all([
        getManualEventsFile(env, calendar),
        group ? getManualEventsFile(env, group.key) : { events: [] },
        fetchClassSchoolEvents(calendar),
        Promise.all(siblings.map((cls) => fetchClassSchoolEvents(cls.code))),
        getJsonFile(env, "data/whole_school_overrides.json", {}),
      ])
    );
    const siblingIds = new Set(siblingSchoolEvents.flat().map((e) => e.id));
    const school = applyOverrides(schoolEvents, overrides.data).map((e) => ({
      ...e,
      school_event: true,
      year_group: siblingIds.has(e.id),
    }));
    const events = [...own.events, ...shared.events.map((e) => ({ ...e, year_group: true })), ...school];
    const sorted = events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return jsonResponse({ events: sorted });
  } catch (err) {
    return jsonResponse(readErrorResponse(err), 502);
  }
}
