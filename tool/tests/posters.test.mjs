// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { isJpeg, posterKeyFromUrl, splitPosterLine } from "../functions/api/_shared/posters.ts";
import { validateEventInput } from "../functions/api/_shared/validate.ts";
import { extractEvents } from "../functions/api/_shared/wholeSchool.ts";
import { applyOverrides, normalizeOverride } from "../functions/api/_shared/wholeSchoolOverrides.ts";
import { onRequestPost as upload } from "../functions/api/poster-upload.ts";
import { onRequestGet as serve } from "../functions/posters/[key].ts";

const KEY = "0123456789abcdef01234567.jpg";
const URL_ = `https://calendar-admin.nai.sh/posters/${KEY}`;

test("the build's poster line comes off a published description", () => {
  assert.deepEqual(splitPosterLine(`Bring a torch\n\nPoster: ${URL_}`), { description: "Bring a torch", image: KEY });
  assert.deepEqual(splitPosterLine(`Poster: ${URL_}`), { description: "", image: KEY });
  // Only at the very end, and only one of ours.
  assert.deepEqual(splitPosterLine("Poster: https://example.com/x.jpg"), { description: "Poster: https://example.com/x.jpg", image: null });
  assert.equal(splitPosterLine(`Poster: ${URL_}\n\nMore`).image, null);
});

test("only our own poster URLs give a key", () => {
  assert.equal(posterKeyFromUrl(URL_), KEY);
  assert.equal(posterKeyFromUrl("https://example.com/posters/" + KEY), null);
  assert.equal(posterKeyFromUrl(`https://calendar-admin.nai.sh/posters/../x.jpg`), null);
  assert.equal(posterKeyFromUrl(null), null);
});

test("an event's image must be a poster key", () => {
  const base = { title: "Disco", date: "2026-11-20" };
  assert.equal(validateEventInput({ ...base, image: KEY }).event.image, KEY);
  assert.equal(validateEventInput({ ...base }).event.image, null);
  assert.equal(validateEventInput({ ...base, image: "" }).event.image, null);
  assert.equal(validateEventInput({ ...base, image: "https://example.com/x.jpg" }).valid, false);
});

test("a school event read back from a feed has its poster, not the poster line", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:stpauls-42@school-calendar-feed",
    "SUMMARY:Christmas Fair",
    "DTSTART;VALUE=DATE:20261205",
    "DESCRIPTION:In the hall\\n\\nPoster: https://calendar-admin.nai.sh/posters/012345678",
    " 9abcdef01234567.jpg",
    "IMAGE;DISPLAY=FULLSIZE;FMTTYPE=image/jpeg;VALUE=URI:https://calendar-admin",
    " .nai.sh/posters/0123456789abcdef01234567.jpg",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const [event] = extractEvents(ics);
  assert.equal(event.description, "In the hall");
  assert.equal(event.image, KEY);
});

test("a poster override lays over the published one; a bad one is ignored", () => {
  assert.deepEqual(normalizeOverride({ image: "nope.png" }), {});
  const [event] = applyOverrides([{ id: "1", description: "", location: "", image: null }], { 1: { image: KEY } });
  assert.equal(event.image, KEY);
});

// A stand-in for an R2 bucket.
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options) {
      objects.set(key, { bytes, options });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: o.bytes, httpEtag: '"e"' } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const BOTH = { data: JPEG.toString("base64"), preview: JPEG.toString("base64") };
const env = (extra = {}) => ({ CLASS_PASSWORDS: JSON.stringify({ fosps: "pw" }), ...extra });
const post = (body) => new Request("https://x/api/poster-upload", { method: "POST", body: JSON.stringify(body) });

test("poster-upload stores a JPEG and answers with its key", async () => {
  const bucket = fakeBucket();
  const resp = await upload({ request: post({ calendar: "fosps", passcode: "pw", ...BOTH }), env: env({ POSTERS: bucket }) });
  assert.equal(resp.status, 200);
  const { image } = await resp.json();
  assert.match(image, /^[0-9a-f]{24}\.jpg$/);
  assert.equal(bucket.objects.get(image).options.httpMetadata.contentType, "image/jpeg");
  assert.ok(bucket.objects.has(image.replace(".jpg", "-p.jpg")), "and its link-preview copy");

  const served = await serve({ params: { key: image }, env: env({ POSTERS: bucket }) });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.equal((await serve({ params: { key: image.replace(".jpg", "-p.jpg") }, env: env({ POSTERS: bucket }) })).status, 200);
  assert.equal((await serve({ params: { key: "../secret" }, env: env({ POSTERS: bucket }) })).status, 404);
});

test("poster-upload refuses non-JPEGs, wrong passcodes, and a missing bucket", async () => {
  const bucket = fakeBucket();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
  assert.equal((await upload({ request: post({ calendar: "fosps", passcode: "pw", ...BOTH, preview: png }), env: env({ POSTERS: bucket }) })).status, 400);
  assert.equal((await upload({ request: post({ calendar: "fosps", passcode: "no", ...BOTH }), env: env({ POSTERS: bucket }) })).status, 401);
  assert.equal((await upload({ request: post({ calendar: "fosps", passcode: "pw", ...BOTH }), env: env() })).status, 503);
  assert.equal(bucket.objects.size, 0);
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8])), false);
});

test("an event's WhatsApp message is short: title, when/where, link", async () => {
  const { whatsAppEventMessage, eventPageKey } = await import("../appHelpers.ts");
  const base = { key: eventPageKey("1a4e2f2ddd1f", false), title: "AGM *and* Election", date: "2026-10-08", end_date: null, time: "20:00", end_time: "21:00", location: "School Hall", repeats: null };
  assert.equal(
    whatsAppEventMessage(base, "2026-10-01"),
    "*AGM and Election*\nThu 8 Oct, 20:00–21:00 · School Hall\nhttps://calendar.nai.sh/e/1a4e2f2ddd1f"
  );
  const multi = { ...base, key: eventPageKey("42", true), title: "Half Term", date: "2026-10-26", end_date: "2026-10-30", time: null, end_time: null, location: null };
  assert.equal(whatsAppEventMessage(multi, "2026-10-01"), "*Half Term*\nMon 26 Oct – Fri 30 Oct\nhttps://calendar.nai.sh/e/s42");
  const weekly = { ...base, date: "2027-01-07", time: "09:00", end_time: null, location: null, repeats: "weekly" };
  assert.match(whatsAppEventMessage(weekly, "2026-10-01"), /\nThu 7 Jan 2027, 09:00 \(weekly\)\n/);
});

test("event-ready: the page exists and carries the save's version stamp", async () => {
  const { onRequestGet: ready } = await import("../functions/api/event-ready.ts");
  const realFetch = globalThis.fetch;
  const pages = { "https://calendar.nai.sh/e/abc123": '<meta name="calendar-rev" content="0a1b2c3d">' };
  globalThis.fetch = async (url) => (pages[url] ? new Response(pages[url]) : new Response("", { status: 404 }));
  try {
    const ask = async (query) => (await ready({ request: new Request(`https://x/api/event-ready?${query}`) })).json();
    assert.deepEqual(await ask("key=abc123&rev=0a1b2c3d"), { ready: true });
    assert.deepEqual(await ask("key=abc123&rev=ffffffff"), { ready: false }); // an older page
    assert.deepEqual(await ask("key=abc123"), { ready: true });
    assert.deepEqual(await ask("key=s99"), { ready: false }); // not built yet
    assert.equal((await ready({ request: new Request("https://x/api/event-ready?key=../x") })).status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an override's version stamp is kept only alongside real fields", () => {
  assert.deepEqual(normalizeOverride({ image: KEY, rev: "0a1b2c3d" }), { image: KEY, rev: "0a1b2c3d" });
  assert.deepEqual(normalizeOverride({ rev: "0a1b2c3d" }), {});
});
