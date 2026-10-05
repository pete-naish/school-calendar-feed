import { FOSPS, isValidCalendar, isWholeSchoolCalendar } from "./_shared/calendars.ts";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.ts";
import { retryable } from "./_shared/github.ts";
import { fetchIcsText, isoToDay, dayToIso } from "./_shared/ics.ts";
import { buildWeekText, defaultWeekStart, snapToMonday, weekEnd } from "./_shared/weekList.ts";
import { readErrorResponse } from "./_shared/errors.ts";
import type { RequestBody } from "./_shared/types.d.ts";
import type { ApiContext } from "./_shared/env.ts";
import { recordUsage } from "./_shared/usageStats.ts";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayToIso(isoToDay(value)) === value;
}

// The "What's on this week" WhatsApp list for the signed-in calendar: its own
// events plus whole-school ones (and FOSPS ones, for a class), Monday-Sunday,
// read from the published .ics files (see _shared/weekList.ts). `week_start`
// (any date in the wanted week) is optional; the default is this week, or next
// week on a Sunday. `emoji: true` puts an emoji in place of each event's
// bullet where one fits (_shared/weekEmoji.ts).
export async function onRequestPost(ctx: ApiContext) {
  const { request, env } = ctx;
  let body: RequestBody;
  try {
    body = (await request.json<RequestBody | null>()) || {};
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode, week_start: requestedWeek } = body;
  const emoji = body.emoji === true;

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }
  if (requestedWeek !== undefined && !isValidIsoDate(requestedWeek)) {
    return jsonResponse({ error: "invalid_week", message: "week_start must be a YYYY-MM-DD date." }, 400);
  }

  const weekStart = typeof requestedWeek === "string" ? snapToMonday(requestedWeek) : defaultWeekStart();

  const isClass = !isWholeSchoolCalendar(calendar) && calendar !== FOSPS.code;

  try {
    const [wholeSchoolIcs, calendarIcs, fospsIcs] = await retryable(() =>
      Promise.all([
        fetchIcsText("whole-school.ics"),
        isWholeSchoolCalendar(calendar) ? null : fetchIcsText(`${calendar}.ics`),
        isClass ? fetchIcsText(`${FOSPS.code}.ics`) : null,
      ])
    );
    const { text, count } = buildWeekText({ calendarIcs, wholeSchoolIcs, fospsIcs, calendar, weekStart, emoji });
    await recordUsage(ctx, calendar, { week_view: 1 });
    return jsonResponse({ week_start: weekStart, week_end: weekEnd(weekStart), text, count });
  } catch (err) {
    return jsonResponse(readErrorResponse(err), 502);
  }
}
