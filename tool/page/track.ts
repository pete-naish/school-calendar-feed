// Counts a rep action that only happens in the page (copying the week's list,
// downloading the QR code...) towards the weekly usage counts - see
// functions/api/_shared/usageStats.ts. Fire and forget: keepalive lets it
// finish even if the rep navigates away, and a failure is nobody's problem.
import { state } from "./state.js";
import type { PageAction } from "../functions/api/_shared/types.d.ts";

export function track(action: PageAction) {
  if (!state.calendar || !state.passcode) return;
  fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ calendar: state.calendar, passcode: state.passcode, action }),
    keepalive: true,
  }).catch(() => {});
}
