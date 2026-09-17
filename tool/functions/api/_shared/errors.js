// Turns a caught GitHub/network error into a response a non-technical rep
// can actually act on, instead of a raw "GitHub PUT failed: 503 ..." - the
// detailed error still goes to the Cloudflare Functions log via
// console.error for anyone actually debugging it.

export function commitErrorResponse(err) {
  console.error("Manual event write failed:", err);
  return {
    error: "commit_failed",
    message: "Couldn't save that after a few tries - please try again in a moment.",
  };
}

export function readErrorResponse(err) {
  console.error("Manual event read failed:", err);
  return {
    error: "list_failed",
    message: "Couldn't load your calendar's events after a few tries - please try again in a moment.",
  };
}
