// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { commitWholeSchoolOverride, isSchoolEventId } from "../functions/api/_shared/wholeSchoolOverrides.js";
import { onRequestPost as update } from "../functions/api/events-update.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ICS = (...ids) =>
  [
    "BEGIN:VCALENDAR",
    ...ids.flatMap((id) => ["BEGIN:VEVENT", `UID:stpauls-${id}@school-calendar-feed`, `SUMMARY:Event ${id}`, "DTSTART;VALUE=DATE:20261007", "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");

// A fake GitHub (an empty overrides file) plus a published whole-school feed
// holding the given event ids. Returns every PUT body.
function fakeSite(...feedIds) {
  const puts = [];
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      puts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ commit: { sha: "abc" } }), { status: 200 });
    }
    if (String(url).includes("/actions/workflows/")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/calendars/whole-school.ics")) return new Response(ICS(...feedIds), { status: 200 });
    return new Response(JSON.stringify({ content: Buffer.from("{}\n").toString("base64"), sha: "sha1" }), { status: 200 });
  };
  return puts;
}

const env = { GITHUB_TOKEN: "t", CLASS_PASSWORDS: JSON.stringify({ "whole-school": "ws" }) };
const editWholeSchool = (id) =>
  update({
    request: new Request("https://x/api", {
      method: "POST",
      body: JSON.stringify({ calendar: "whole-school", passcode: "ws", id, description: "Parking on the field" }),
    }),
    env,
  });

test("isSchoolEventId accepts the school's numeric ids and nothing else", () => {
  for (const id of ["859", "1", "000123", "123456789012"]) assert.equal(isSchoolEventId(id), true, id);
  for (const id of ["", "abc", "12 3", "1.5", "-4", "__proto__", "constructor", "../x", "1234567890123", "859\n", 859, null, undefined]) {
    assert.equal(isSchoolEventId(id), false, String(id));
  }
});

test("a whole-school edit for an event in the feed is saved under its id", async () => {
  const puts = fakeSite("859");
  const resp = await editWholeSchool("859");
  assert.equal(resp.status, 200);
  assert.equal(puts.length, 1);
  const written = JSON.parse(Buffer.from(puts[0].content, "base64").toString());
  assert.deepEqual(written, { 859: { description: "Parking on the field" } });
});

test("a whole-school edit for an id that isn't in the feed is a 404 and writes nothing", async () => {
  const puts = fakeSite("859");
  const resp = await editWholeSchool("999");
  assert.equal(resp.status, 404);
  assert.equal((await resp.json()).error, "not_found");
  assert.equal(puts.length, 0);
});

test("ids that aren't school event ids never reach the overrides file", async () => {
  const puts = fakeSite("859");
  for (const id of ["__proto__", "constructor", "abc", "859 ", "../../etc", "8".repeat(40)]) {
    const resp = await editWholeSchool(id);
    assert.equal(resp.status, 404, id);
  }
  assert.equal(puts.length, 0);
});

test("commitWholeSchoolOverride itself refuses a bad id, whoever calls it", async () => {
  const puts = fakeSite();
  for (const id of ["__proto__", "abc", ""]) {
    const result = await commitWholeSchoolOverride(env, id, { description: "x" });
    assert.equal(result.error, "invalid_id", id);
  }
  assert.equal(puts.length, 0);
  assert.equal((await commitWholeSchoolOverride(env, "859", { description: "x" })).error, undefined);
  assert.equal(puts.length, 1);
});
