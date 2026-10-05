// POST /api/stats - {calendar, passcode}: how many times parents have tapped
// a subscribe link for this calendar on the public page, all-time, this month
// and per platform, for the tool's Share tab. Read from the counters
// subscribe-click.ts keeps (see _shared/clickStats.ts). Opening the tab is
// also counted as rep usage (`share_view`, see _shared/usageStats.ts).
import { isValidCalendar } from "./_shared/calendars.ts";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.ts";
import { PLATFORMS, clickTotals } from "./_shared/clickStats.ts";
import { recordUsage } from "./_shared/usageStats.ts";
import type { RequestBody, StatsResponse } from "./_shared/types.d.ts";
import type { ApiContext } from "./_shared/env.ts";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost(ctx: ApiContext) {
  const { request, env } = ctx;
  let body: RequestBody;
  try {
    body = (await request.json<RequestBody | null>()) || {};
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode } = body;
  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }

  await recordUsage(ctx, calendar, { share_view: 1 });

  if (!env.STATS) {
    const none = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
    return jsonResponse({ available: false, total: 0, this_month: 0, by_platform: none } as StatsResponse);
  }
  try {
    const totals = await clickTotals(env.STATS, calendar);
    return jsonResponse({ available: true, ...totals } as StatsResponse);
  } catch (err) {
    console.error("reading click counts failed", err);
    return jsonResponse({ error: "stats_unavailable", message: "Couldn't load the subscribe count just now." }, 502);
  }
}
