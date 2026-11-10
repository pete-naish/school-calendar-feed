// POST /api/poster-upload - stores one poster image in the POSTERS R2 bucket
// and answers with its key, which the page then saves as the event's `image`
// along with the rest of the event (see _shared/posters.ts). Uploading on its
// own, before the event is saved, keeps the save requests small; a poster
// picked for an event that's then never saved is simply left unused.
//
// Body: {calendar, passcode, data, preview}: the poster and its link-preview
// copy (see previewKey()), each a JPEG as base64.
import { isValidCalendar } from "./_shared/calendars.ts";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.ts";
import { MAX_POSTER_BYTES, MAX_PREVIEW_BYTES, decodeBase64, isJpeg, newPosterKey, previewKey } from "./_shared/posters.ts";
import type { RequestBody } from "./_shared/types.d.ts";
import type { ApiContext } from "./_shared/env.ts";
import { recordUsage } from "./_shared/usageStats.ts";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// Base64 JPEG to bytes, or why not.
function readJpeg(value: unknown, maxBytes: number): Uint8Array | "too_big" | "not_jpeg" {
  // Base64 is 4 characters per 3 bytes: check the length before decoding.
  if (typeof value !== "string" || !value) return "not_jpeg";
  if (value.length > Math.ceil(maxBytes / 3) * 4) return "too_big";
  const bytes = decodeBase64(value);
  return bytes && isJpeg(bytes) ? bytes : "not_jpeg";
}

export async function onRequestPost(ctx: ApiContext) {
  const { request, env } = ctx;
  let body: RequestBody;
  try {
    body = (await request.json<RequestBody | null>()) || {};
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode, data, preview } = body;
  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
  }
  if (!env.POSTERS) {
    return jsonResponse({ error: "not_available", message: "Posters aren't set up yet." }, 503);
  }

  const poster = readJpeg(data, MAX_POSTER_BYTES);
  const small = readJpeg(preview, MAX_PREVIEW_BYTES);
  if (typeof poster === "string" || typeof small === "string") {
    const message = poster === "too_big" || small === "too_big" ? "That image is too big - try a smaller one." : "That doesn't look like an image - try another.";
    return jsonResponse({ error: "validation_failed", message }, 400);
  }

  const key = newPosterKey();
  const options = { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { calendar } };
  await Promise.all([env.POSTERS.put(key, poster, options), env.POSTERS.put(previewKey(key), small, options)]);
  await recordUsage(ctx, calendar, { poster_upload: 1 });
  return jsonResponse({ image: key });
}
