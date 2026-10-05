// POST /api/track - {calendar, passcode, action}: counts one rep action that
// happens only in the page (copying the week's list, downloading the QR
// code...), for the weekly usage counts in _shared/usageStats.ts. Only
// PAGE_ACTIONS are accepted, and only with the calendar's passcode, so the
// counts can't be padded from outside.
//
// Always 204: the page sends it and moves on (fetch with keepalive), so
// there's nobody to tell about a refusal.
import { isValidCalendar } from "./_shared/calendars.ts";
import { checkPasscode } from "./_shared/auth.ts";
import { isPageAction, recordUsage } from "./_shared/usageStats.ts";
import type { RequestBody } from "./_shared/types.d.ts";
import type { ApiContext } from "./_shared/env.ts";

const noContent = () => new Response(null, { status: 204 });

export async function onRequestPost(ctx: ApiContext) {
  const { request, env } = ctx;
  let body: RequestBody;
  try {
    body = (await request.json<RequestBody | null>()) || {};
  } catch {
    return noContent();
  }
  const { calendar, passcode, action } = body;
  if (!env.STATS || !isValidCalendar(calendar) || !isPageAction(action)) return noContent();
  if ((await checkPasscode(env, calendar, passcode, request)) !== "ok") return noContent();
  await recordUsage(ctx, calendar, { [action]: 1 });
  return noContent();
}
