import { isValidCalendar, isWholeSchoolCalendar } from "./_shared/calendars.ts";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.ts";
import { commitEventById, triggerRebuild } from "./_shared/github.ts";
import { commitErrorResponse, resultStatus } from "./_shared/errors.ts";
import type { RequestBody } from "./_shared/types.d.ts";
import type { ApiContext } from "./_shared/env.ts";
import { recordUsage } from "./_shared/usageStats.ts";

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

  const { calendar, passcode, id } = body;

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }
  // Whole School events aren't stored here at all (they come from the
  // school's own feed) - nothing to delete via this tool.
  if (isWholeSchoolCalendar(calendar)) {
    return jsonResponse(
      { error: "not_allowed", message: "Whole School events can't be deleted here - only their description and location can be edited." },
      403
    );
  }
  if (typeof id !== "string" || !id) {
    return jsonResponse({ error: "missing_id" }, 400);
  }

  try {
    // The event is in this class's own file or its year group's shared one;
    // deleting a shared event removes it from every class in the year.
    const result = await commitEventById<{}>(
      env,
      calendar,
      async (current) => {
        const index = current.findIndex((e) => e.id === id);
        if (index === -1) return { error: "not_found" };
        const updated = current.filter((e) => e.id !== id);
        return { events: updated };
      },
      `Remove event from ${calendar}`
    );
    if (result.error) {
      return jsonResponse(result, resultStatus(result));
    }
    await recordUsage(ctx, calendar, { delete: 1 });
    return jsonResponse({ deleted: true, rebuild_triggered: await triggerRebuild(env) });
  } catch (err) {
    return jsonResponse(commitErrorResponse(err), 502);
  }
}
