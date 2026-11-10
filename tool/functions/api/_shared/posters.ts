// Event posters: images a rep attaches to an event, kept in the POSTERS R2
// bucket and served by functions/posters/[key].ts from this tool's own origin.
// An event stores only the poster's key ("<24 hex>.jpg", the `image` field);
// scripts/build_ics.py turns it into the URL below, publishing it both as an
// RFC 7986 IMAGE property and as a "Poster: <url>" line at the end of the
// DESCRIPTION, since calendar apps ignore IMAGE but show a link. Anything
// that reads a description back out of a published .ics strips that line
// (splitPosterLine), so it never ends up saved as part of a description.
//
// Keep POSTER_ORIGIN, the key pattern and the line's wording in step with
// POSTER_BASE_URL in scripts/build_ics.py and docs/assets/calendar.ts.

export const POSTER_ORIGIN = "https://calendar-admin.nai.sh";
// The public site (docs/CNAME), whose /e/<key> pages link previews come from.
export const SITE_URL = "https://calendar.nai.sh";
const POSTER_PATH = "/posters/";

const KEY_RE = /^[0-9a-f]{24}\.jpg$/;

// The page shrinks a poster to a JPEG of at most 1600px before uploading it
// (page/poster.ts), which comes to a few hundred KB; this is just the ceiling.
export const MAX_POSTER_BYTES = 2_000_000;

export function isPosterKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RE.test(value);
}

export function cleanPosterKey(value: unknown): string | null {
  return isPosterKey(value) ? value : null;
}

// The link-preview copy the page uploads beside every poster: 1200x630 with
// the poster fitted in (page/poster.ts), the shape WhatsApp shows as a big
// preview, and small enough that it shows one at all. The event pages
// scripts/build_ics.py writes (docs/e/) give it as their og:image.
export function previewKey(key: string) {
  return key.replace(/\.jpg$/, "-p.jpg");
}

const SERVED_RE = /^[0-9a-f]{24}(?:-p)?\.jpg$/;

// A poster or its preview - what functions/posters/[key].ts will serve.
export function isServedKey(value: unknown): value is string {
  return typeof value === "string" && SERVED_RE.test(value);
}

export const MAX_PREVIEW_BYTES = 300_000;

export function posterUrl(key: string) {
  return `${POSTER_ORIGIN}${POSTER_PATH}${key}`;
}

// The key a published IMAGE value points at, or null for anything that
// isn't one of ours.
export function posterKeyFromUrl(url: string | null | undefined): string | null {
  const prefix = `${POSTER_ORIGIN}${POSTER_PATH}`;
  if (!url || !url.startsWith(prefix)) return null;
  return cleanPosterKey(url.slice(prefix.length));
}

const LINE_RE = /(?:^|\n\n)Poster: https:\/\/calendar-admin\.nai\.sh\/posters\/([0-9a-f]{24}\.jpg)\s*$/;

// A published description with the build's "Poster: <url>" line taken off the
// end, and the key it named (null when there was none).
export function splitPosterLine(description: string): { description: string; image: string | null } {
  const match = description.match(LINE_RE);
  if (!match) return { description, image: null };
  return { description: description.slice(0, match.index).trimEnd(), image: match[1] };
}

export function newPosterKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}.jpg`;
}

// Every JPEG starts FF D8 FF. Only JPEGs are accepted: that's what the page
// makes, and it means nothing else (an SVG with script in it, say) can be
// served from this origin as a "poster".
export function isJpeg(bytes: Uint8Array) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Base64 to bytes, or null if it isn't valid base64.
export function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
