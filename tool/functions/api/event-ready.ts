// GET /api/event-ready?key=<key>&rev=<rev> - whether an event's page on the
// public site (/e/<key>, written by scripts/build_ics.py's write_event_pages())
// shows the event as last saved: it exists, and carries the save's version
// stamp (`rev`, see generateRev() in _shared/github.ts) in its
// <meta name="calendar-rev">. WhatsApp builds a link's preview from that page
// once and keeps it, so page/eventShare.ts asks this before telling a rep their
// link is ready to post.
//
// The page is fetched the way WhatsApp would, through GitHub Pages' cache, so
// "ready" also means the cache has caught up. No passcode: it only ever reads
// one public page on the public site, named by a checked key.
import { SITE_URL } from "./_shared/posters.ts";
import type { EventReadyResponse } from "./_shared/types.d.ts";

// A manual event's id, or "s" + a school event's - as event_page_key() makes.
const KEY_RE = /^(?:[0-9A-Za-z]{1,40}|s\d{1,12})$/;
const REV_RE = /^[0-9a-f]{8}$/;

function jsonResponse(obj: EventReadyResponse | { error: string }, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestGet({ request }: { request: Request }) {
  const params = new URL(request.url).searchParams;
  const key = params.get("key") ?? "";
  const rev = params.get("rev");
  if (!KEY_RE.test(key) || (rev !== null && !REV_RE.test(rev))) {
    return jsonResponse({ error: "invalid_id" }, 400);
  }
  try {
    const resp = await fetch(`${SITE_URL}/e/${key}`, { redirect: "follow" });
    if (!resp.ok) return jsonResponse({ ready: false });
    if (!rev) return jsonResponse({ ready: true });
    const html = await resp.text();
    return jsonResponse({ ready: html.includes(`<meta name="calendar-rev" content="${rev}">`) });
  } catch {
    // Can't reach the site: not known to be ready.
    return jsonResponse({ ready: false });
  }
}
