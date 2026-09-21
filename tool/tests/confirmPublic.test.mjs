// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as save } from "../functions/api/save.js";
import { onRequestPost as update } from "../functions/api/events-update.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const b64 = (data) => Buffer.from(`${JSON.stringify(data, null, 2)}\n`).toString("base64");

// A published feed holding one school event (id 859) with the given description.
const ics = (title, description) =>
  [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:stpauls-859@school-calendar-feed",
    `SUMMARY:${title}`,
    "DTSTART;VALUE=DATE:20261007",
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

// A fake GitHub holding one JSON file, and the published feeds. Returns the PUTs.
function fakeSite({ file = [], wholeSchool = ics("Inset Day", "Parking on the field"), fiveHp = ics("5HP: Trip", "Bring a packed lunch") } = {}) {
  const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (init.method === "PUT") {
      puts.push(JSON.parse(Buffer.from(JSON.parse(init.body).content, "base64").toString()));
      return new Response(JSON.stringify({ commit: { sha: "abc" } }), { status: 200 });
    }
    if (u.includes("/actions/workflows/")) return new Response(null, { status: 204 });
    if (u.endsWith("/calendars/whole-school.ics")) return new Response(wholeSchool, { status: 200 });
    if (u.endsWith("/calendars/y5-b.ics")) return new Response(fiveHp, { status: 200 });
    return new Response(JSON.stringify({ content: b64(u.includes("whole_school_overrides") ? {} : file), sha: "sha1" }), { status: 200 });
  };
  return puts;
}

const env = { GITHUB_TOKEN: "t", CLASS_PASSWORDS: JSON.stringify({ "y5-b": "pw", "whole-school": "ws" }) };
const post = (handler, body) =>
  handler({ request: new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), env });
const saveEvents = (events, extra = {}) => post(save, { calendar: "y5-b", passcode: "pw", events, ...extra });
const updateEvent = (id, event, extra = {}) => post(update, { calendar: "y5-b", passcode: "pw", id, event, ...extra });

const MOBILE = "07700 900123";

// --- new events (save.js) ---

test("a new event with a mobile number is held for confirmation, and nothing is written", async () => {
  const puts = fakeSite();
  const resp = await saveEvents([{ title: "Coffee", date: "2026-10-01", description: `Ring Sarah on ${MOBILE}` }]);
  assert.equal(resp.status, 409);
  const body = await resp.json();
  assert.equal(body.error, "confirm_public");
  assert.match(body.message, /the description has a mobile number \(07700 900123\)/);
  assert.match(body.message, /Save anyway\?$/);
  assert.deepEqual(body.findings.map((f) => [f.index, f.field, f.kind]), [[0, "description", "mobile"]]);
  assert.equal(puts.length, 0);
});

test("the same save with confirm_public: true goes through, number and all", async () => {
  const puts = fakeSite();
  const resp = await saveEvents([{ title: "Coffee", date: "2026-10-01", description: `Ring Sarah on ${MOBILE}` }], { confirm_public: true });
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).saved, 1);
  assert.equal(puts.length, 1);
  assert.match(puts[0][0].description, /07700 900123/);
});

test("only a literal true confirms - not a string, a number or a truthy object", async () => {
  for (const confirm_public of ["true", 1, "yes", {}, [true]]) {
    const puts = fakeSite();
    const resp = await saveEvents([{ title: "Coffee", date: "2026-10-01", description: MOBILE }], { confirm_public });
    assert.equal(resp.status, 409, JSON.stringify(confirm_public));
    assert.equal(puts.length, 0);
  }
});

test("an ordinary event needs no confirmation", async () => {
  const puts = fakeSite();
  const resp = await saveEvents([
    { title: "Bake Sale", date: "2026-10-01", description: "Cakes in the hall from 3pm, email office@st-pauls.enfield.sch.uk", location: "The King's Head, 1 The Green, N21 1BB" },
  ]);
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

test("with several events the message says which one, and none are saved until confirmed", async () => {
  const puts = fakeSite();
  const resp = await saveEvents([
    { title: "Fine", date: "2026-10-01" },
    { title: "Quiz", date: "2026-10-02", description: "RSVP sarah@gmail.com" },
    { title: "Trip", date: "2026-10-03", location: "chat.whatsapp.com/AbCd1234" },
  ]);
  assert.equal(resp.status, 409);
  const { message, findings } = await resp.json();
  assert.match(message, /Event 2: the description has a personal email address \(sarah@gmail\.com\); Event 3: the location has a WhatsApp link/);
  assert.deepEqual(findings.map((f) => f.index), [1, 2]);
  assert.equal(puts.length, 0, "the clean first event must not be saved on its own");
});

test("a number in the title is caught too", async () => {
  fakeSite();
  const resp = await saveEvents([{ title: `Call ${MOBILE} for tickets`, date: "2026-10-01" }]);
  assert.equal(resp.status, 409);
  assert.equal((await resp.json()).findings[0].field, "title");
});

test("a validation error is reported before, and instead of, the confirmation", async () => {
  fakeSite();
  const resp = await saveEvents([{ title: "Coffee", date: "2026-02-30", description: MOBILE }]);
  assert.equal(resp.status, 400);
  assert.equal((await resp.json()).error, "validation_failed");
});

test("PII is checked on what was validated: a 'url' field can't smuggle text past it, and a link isn't a contact", async () => {
  const puts = fakeSite();
  const resp = await saveEvents([{ title: "Info", date: "2026-10-01", url: "https://example.com/07700900123" }]);
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

// --- editing a saved event (events-update.js) ---

const saved = (description) => ({ id: "e1", title: "Coffee", date: "2026-10-01", time: "09:00", end_time: null, description, location: null, url: null, recurrence: null, exceptions: [] });
const edit = (description, extra = {}) => ({ title: "Coffee", date: "2026-10-01", time: "10:00", description, ...extra });

test("adding a number to a saved event asks first, and writes nothing", async () => {
  const puts = fakeSite({ file: [saved("Cakes in the hall")] });
  const resp = await updateEvent("e1", edit(`Cakes in the hall. Ring ${MOBILE}`));
  assert.equal(resp.status, 409);
  assert.equal((await resp.json()).error, "confirm_public");
  assert.equal(puts.length, 0);
});

test("...and saves once confirmed", async () => {
  const puts = fakeSite({ file: [saved("Cakes in the hall")] });
  const resp = await updateEvent("e1", edit(`Cakes in the hall. Ring ${MOBILE}`), { confirm_public: true });
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
  assert.match(puts[0][0].description, /07700 900123/);
});

test("editing something else on an event that already has a confirmed number doesn't ask again", async () => {
  const puts = fakeSite({ file: [saved(`Ring Sarah on ${MOBILE}`)] });
  const resp = await updateEvent("e1", edit(`Ring Sarah on ${MOBILE}`)); // only the time changed
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

test("the same number reformatted isn't new either", async () => {
  fakeSite({ file: [saved(`Ring Sarah on ${MOBILE}`)] });
  const resp = await updateEvent("e1", edit("Ring Sarah on +447700900123 - new time"));
  assert.equal(resp.status, 200);
});

test("adding a second number beside an old one asks, naming only the new one", async () => {
  const puts = fakeSite({ file: [saved(`Ring ${MOBILE}`)] });
  const resp = await updateEvent("e1", edit(`Ring ${MOBILE} or 07700 900456`));
  assert.equal(resp.status, 409);
  const { findings } = await resp.json();
  assert.deepEqual(findings.map((f) => f.text), ["07700 900456"]);
  assert.equal(puts.length, 0);
});

test("an event that isn't there is still a 404, not a confirmation", async () => {
  fakeSite({ file: [saved("x")] });
  const resp = await updateEvent("nope", edit(MOBILE));
  assert.equal(resp.status, 404);
});

// --- description/location edits on school events ---

const overrideBody = (calendar, changes, extra = {}) => ({
  calendar,
  passcode: calendar === "whole-school" ? "ws" : "pw",
  id: "859",
  ...(calendar === "whole-school" ? {} : { school_event: true }),
  ...changes,
  ...extra,
});

test("a whole-school description that adds a number asks first", async () => {
  const puts = fakeSite();
  const resp = await post(update, overrideBody("whole-school", { description: `Parking on the field. Ring ${MOBILE}` }));
  assert.equal(resp.status, 409);
  assert.match((await resp.json()).message, /the description has a mobile number/);
  assert.equal(puts.length, 0);
});

test("...and saves once confirmed", async () => {
  const puts = fakeSite();
  const resp = await post(update, overrideBody("whole-school", { description: `Parking. Ring ${MOBILE}` }, { confirm_public: true }));
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

test("a number the school's own published text already has isn't the rep's to be warned about", async () => {
  const puts = fakeSite({ wholeSchool: ics("Inset Day", `Office on ${MOBILE}, parking on the field`) });
  const resp = await post(update, overrideBody("whole-school", { description: `Office on ${MOBILE}, parking on the field. Bring a hat.` }));
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});

test("a location with an email is caught on a whole-school edit", async () => {
  fakeSite();
  const resp = await post(update, overrideBody("whole-school", { location: "sarah@gmail.com" }));
  assert.equal(resp.status, 409);
  assert.equal((await resp.json()).findings[0].field, "location");
});

test("a class's school-event description edit is checked the same way", async () => {
  const puts = fakeSite();
  const asked = await post(update, overrideBody("y5-b", { description: `Bring lunch. Ring ${MOBILE}` }));
  assert.equal(asked.status, 409);
  assert.equal(puts.length, 0);
  const confirmed = await post(update, overrideBody("y5-b", { description: `Bring lunch. Ring ${MOBILE}` }, { confirm_public: true }));
  assert.equal(confirmed.status, 200);
  assert.equal(puts.length, 1);
});

test("a clean school-event edit needs no confirmation", async () => {
  const puts = fakeSite();
  const resp = await post(update, overrideBody("whole-school", { description: "Parking on the field, bring a hat" }));
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
});
