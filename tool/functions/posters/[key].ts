// GET /posters/<key> - serves an event poster (or its link-preview copy) from the POSTERS R2 bucket (see
// ../api/_shared/posters.ts). Public, like the .ics feeds that link to it:
// keys are random and never reused, so a poster can be cached for good.
import { isServedKey } from "../api/_shared/posters.ts";
import type { Env } from "../api/_shared/env.ts";

export async function onRequestGet({ params, env }: { params: Record<string, string | string[]>; env: Env }) {
  const key = params.key;
  if (!env.POSTERS || !isServedKey(key)) return new Response("Not found", { status: 404 });
  const object = await env.POSTERS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
      // Shown on the parent page, which is on another origin.
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
