// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { knownEventList, resolveAlreadyListed } from "../functions/api/_shared/duplicates.ts";
import { onRequestPost as parse } from "../functions/api/parse.ts";

const TODAY = "2026-10-03";
const school = (title, date, end_date = date) => ({ id: "1", title, date, end_date, time: null, end_time: null, description: "", location: "" });
const manual = (title, date, extra = {}) => ({
  id: "abc",
  title,
  date,
  end_date: null,
  time: null,
  end_time: null,
  description: null,
  location: null,
  url: null,
  recurrence: null,
  exceptions: [],
  ...extra,
});

test("the known-event list skips past events and numbers the rest", () => {
  const { refs, text } = knownEventList(
    [
      { event: school("Harvest Festival", "2026-09-30"), source: "whole_school" },
      { event: school("Young Minds - Hello Yellow", "2026-10-09"), source: "whole_school" },
      { event: manual("Library Day", "2026-10-06"), source: "class" },
    ],
    TODAY
  );
  assert.equal(refs.size, 2);
  assert.equal(text, "e1 | 2026-10-09 | Young Minds - Hello Yellow | Whole School\ne2 | 2026-10-06 | Library Day | this class");
});

test("a repeating event counts as upcoming until its repeat ends", () => {
  const { refs, text } = knownEventList(
    [{ event: manual("PE", "2026-09-07", { recurrence: { freq: "WEEKLY", interval: 1, until: "2026-10-23" } }), source: "year_group" }],
    TODAY
  );
  assert.equal(refs.size, 1);
  assert.match(text, /repeats until 2026-10-23 \| PE \| whole year group/);
  assert.ok(resolveAlreadyListed({ date: "2026-10-12", end_date: null }, "e1", refs));
});

test("a match is only kept when the dates overlap", () => {
  const { refs } = knownEventList(
    [
      { event: school("Young Minds - Hello Yellow", "2026-10-09"), source: "whole_school" },
      { event: school("Half Term", "2026-10-26", "2026-10-30"), source: "whole_school" },
    ],
    TODAY
  );
  assert.deepEqual(resolveAlreadyListed({ date: "2026-10-09", end_date: null }, "e1", refs), {
    title: "Young Minds - Hello Yellow",
    date: "2026-10-09",
    end_date: "2026-10-09",
    time: null,
    end_time: null,
    source: "whole_school",
  });
  assert.equal(resolveAlreadyListed({ date: "2026-10-08", end_date: null }, "e1", refs), null);
  // A single day inside a multi-day event, and a span that overlaps one.
  assert.ok(resolveAlreadyListed({ date: "2026-10-28", end_date: null }, "e2", refs));
  assert.ok(resolveAlreadyListed({ date: "2026-10-23", end_date: "2026-10-26" }, "e2", refs));
});

test("no ref, or one that isn't in the list, is no match", () => {
  const { refs } = knownEventList([{ event: school("Hello Yellow", "2026-10-09"), source: "whole_school" }], TODAY);
  assert.equal(resolveAlreadyListed({ date: "2026-10-09", end_date: null }, null, refs), null);
  assert.equal(resolveAlreadyListed({ date: "2026-10-09", end_date: null }, "e7", refs), null);
  assert.equal(resolveAlreadyListed({ date: "2026-10-09", end_date: null }, 1, refs), null);
});

// The endpoint, with fetch stubbed per URL.
const realFetch = globalThis.fetch;
const realConsoleError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

const env = { ANTHROPIC_API_KEY: "sk-ant-x", CLASS_PASSWORDS: JSON.stringify({ "rec-a": "pw" }) };
// A date safely ahead of the real today, so the known event counts as upcoming.
const SOON = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const WHOLE_SCHOOL_ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "SUMMARY:Young Minds - Hello Yellow",
  `DTSTART;VALUE=DATE:${SOON.replace(/-/g, "")}`,
  "UID:stpauls-866@school-calendar-feed",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

function stubFetch({ failReads = false } = {}) {
  const seen = { prompt: null };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith("https://api.anthropic.com")) {
      seen.prompt = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: "record_events",
              input: {
                events: [
                  { title: "Hello Yellow", date: SOON, already_listed: "e1" },
                  { title: "Fruit Kebabs", date: SOON, already_listed: null },
                ],
              },
            },
          ],
        })
      );
    }
    if (failReads) throw new Error("network down");
    if (url.startsWith("https://api.github.com")) return new Response("", { status: 404 });
    if (url.endsWith("/whole-school.ics")) return new Response(WHOLE_SCHOOL_ICS);
    return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  };
  return seen;
}

const extract = () =>
  parse({
    request: new Request("https://x/api/parse", {
      method: "POST",
      body: JSON.stringify({ calendar: "rec-a", passcode: "pw", text: "Hello Yellow and fruit kebabs on Friday" }),
    }),
    env,
  });

test("an event the model matches to a known one comes back flagged", async () => {
  const seen = stubFetch();
  const resp = await extract();
  assert.equal(resp.status, 200);
  const { events } = await resp.json();
  assert.equal(events.length, 2);
  assert.equal(events[0].already_listed.title, "Young Minds - Hello Yellow");
  assert.equal(events[0].already_listed.source, "whole_school");
  assert.equal(events[1].already_listed, undefined);
  // The list went to the model ahead of the pasted text.
  const [list, pasted] = seen.prompt.messages[0].content;
  assert.match(list.text, /<already_in_calendar>\ne1 \| .* \| Young Minds - Hello Yellow \| Whole School\n/);
  assert.equal(pasted.text, "Hello Yellow and fruit kebabs on Friday");
});

test("extraction still works when the existing events can't be read", async () => {
  console.error = () => {};
  const seen = stubFetch({ failReads: true });
  const resp = await extract();
  assert.equal(resp.status, 200);
  const { events } = await resp.json();
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.already_listed === undefined));
  assert.equal(seen.prompt.messages[0].content.length, 1);
});

test("Whole School's events are still checked when GitHub can't be read", async () => {
  console.error = () => {};
  const seen = stubFetch();
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.github.com")) throw new Error("GitHub down");
    return stubbed(url, init);
  };
  const { events } = await (await extract()).json();
  assert.equal(events[0].already_listed.title, "Young Minds - Hello Yellow");
  assert.equal(seen.prompt.messages[0].content.length, 2);
});
