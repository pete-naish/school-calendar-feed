// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildWeekText, defaultWeekStart, snapToMonday } from "../functions/api/_shared/weekList.js";
import { titlePrefixFor } from "../functions/api/_shared/calendars.js";

// rec-a's title prefix ("RR: " today), looked up from docs/classes.js so a
// relabel doesn't break these.
const PREFIX = titlePrefixFor("rec-a");

const calendar = (...events) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.map((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"].flat()).flat(), "END:VCALENDAR"].join("\r\n");

const EMPTY = calendar();

function week(weekStart, { own = null, wholeSchool = EMPTY, fosps = null, cal = "rec-a" } = {}) {
  return buildWeekText({ calendarIcs: own, wholeSchoolIcs: wholeSchool, fospsIcs: fosps, calendar: cal, weekStart });
}

const PE_DAY = calendar([
  "UID:manual-pe@school-calendar-feed",
  `SUMMARY:${PREFIX}PE Day 👟 – Wear PE Kit`,
  "DTSTART;VALUE=DATE:20260903",
  "DTEND;VALUE=DATE:20260904",
  "RRULE:FREQ=WEEKLY;UNTIL=20270128;INTERVAL=1",
  "EXDATE;VALUE=DATE:20261022,20261029",
]);

test("weekly recurrence lists its occurrence and strips the class prefix", () => {
  const { text, count } = week("2026-10-12", { own: PE_DAY });
  assert.equal(count, 1);
  assert.equal(text, "*What's on this week (Mon 12 – Sun 18 Oct)*\n\n*Thu 15 Oct*\n• PE Day 👟 – Wear PE Kit");
});

test("weekly recurrence skips EXDATE days", () => {
  const { text, count } = week("2026-10-19", { own: PE_DAY });
  assert.equal(count, 0);
  assert.match(text, /Nothing scheduled this week\./);
});

test("weekly recurrence includes its UNTIL day and stops after it", () => {
  assert.equal(week("2027-01-25", { own: PE_DAY }).count, 1); // Thu 28 Jan is UNTIL
  assert.equal(week("2027-02-01", { own: PE_DAY }).count, 0);
});

test("monthly recurrence with an interval", () => {
  const own = calendar([
    "UID:manual-m@school-calendar-feed",
    `SUMMARY:${PREFIX}Bimonthly coffee`,
    "DTSTART;VALUE=DATE:20260915",
    "DTEND;VALUE=DATE:20260916",
    "RRULE:FREQ=MONTHLY;UNTIL=20270601;INTERVAL=2",
  ]);
  assert.equal(week("2026-09-14", { own }).count, 1); // Tue 15 Sep
  assert.equal(week("2026-10-12", { own }).count, 0); // Oct is skipped
  assert.match(week("2026-11-09", { own }).text, /\*Sun 15 Nov\*/);
});

test("timed recurring event keeps its wall-clock time across the BST to GMT change", () => {
  const own = calendar([
    "UID:manual-t@school-calendar-feed",
    `SUMMARY:${PREFIX}Choir`,
    "DTSTART;TZID=Europe/London:20261015T193000",
    "DTEND;TZID=Europe/London:20261015T203000",
    "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z;INTERVAL=1",
  ]);
  assert.match(week("2026-10-26", { own }).text, /\*Thu 29 Oct\*\n• 7:30pm Choir/);
});

test("a UTC instant just after midnight London time lands on the London day", () => {
  const wholeSchool = calendar([
    "UID:stpauls-1@school-calendar-feed",
    "SUMMARY:Late one",
    "DTSTART:20260703T233000Z",
    "DTEND:20260704T003000Z",
  ]);
  assert.match(week("2026-06-29", { wholeSchool, cal: "whole-school" }).text, /\*Sat 4 Jul\*\n• 12:30am Late one/);
});

test("all-day multi-day event shows its range under its first day", () => {
  const wholeSchool = calendar([
    "UID:stpauls-2@school-calendar-feed",
    "SUMMARY:Half Term Break",
    "DTSTART;VALUE=DATE:20261027",
    "DTEND;VALUE=DATE:20261101",
  ]);
  const { text } = week("2026-10-26", { wholeSchool });
  assert.match(text, /\*Tue 27 Oct\*\n• Half Term Break \(Tue 27 Oct – Sat 31 Oct\) — Whole School/);
  assert.equal(week("2026-10-19", { wholeSchool }).count, 0);
});

test("FOSPS events are listed with their FOSPS prefix", () => {
  const fosps = calendar([
    "UID:manual-wf@school-calendar-feed",
    "SUMMARY:FOSPS: Winter Fair",
    "DTSTART;TZID=Europe/London:20261205T120000",
    "DTEND;TZID=Europe/London:20261205T150000",
  ]);
  const own = calendar([
    "UID:manual-x@school-calendar-feed",
    `SUMMARY:${PREFIX}Class assembly`,
    "DTSTART;TZID=Europe/London:20261204T090000",
    "DTEND;TZID=Europe/London:20261204T093000",
  ]);
  const { text, count } = week("2026-11-30", { own, fosps });
  assert.equal(count, 2);
  assert.match(text, /\*Fri 4 Dec\*\n• 9am Class assembly\n\n\*Sat 5 Dec\*\n• 12pm FOSPS: Winter Fair$/);
});

test("a multi-day event that began before the week is listed under Monday", () => {
  const own = calendar([
    "UID:manual-r@school-calendar-feed",
    `SUMMARY:${PREFIX}Residential`,
    "DTSTART;VALUE=DATE:20261024",
    "DTEND;VALUE=DATE:20261029",
  ]);
  assert.match(week("2026-10-26", { own }).text, /\*Mon 26 Oct\*\n• Residential \(Sat 24 Oct – Wed 28 Oct\)/);
});

test("a moved occurrence is its own one-off event", () => {
  const own = calendar(
    [
      "UID:manual-x@school-calendar-feed",
      `SUMMARY:${PREFIX}Assembly`,
      "DTSTART;TZID=Europe/London:20261008T090000",
      "DTEND;TZID=Europe/London:20261008T100000",
      "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z;INTERVAL=1",
      "EXDATE;TZID=Europe/London:20261015T090000",
    ],
    [
      "UID:manual-x-2026-10-15@school-calendar-feed",
      `SUMMARY:${PREFIX}Assembly`,
      "DTSTART;TZID=Europe/London:20261016T140000",
      "DTEND;TZID=Europe/London:20261016T150000",
    ]
  );
  const { text, count } = week("2026-10-12", { own });
  assert.equal(count, 1);
  assert.match(text, /\*Fri 16 Oct\*\n• 2pm Assembly/);
});

test("HTML in a description is cleaned; location is unescaped; whole-school is marked", () => {
  const wholeSchool = calendar([
    "UID:stpauls-3@school-calendar-feed",
    "SUMMARY:Nasal Flu Spray",
    "DTSTART;VALUE=DATE:20260922",
    "DTEND;VALUE=DATE:20260923",
    "LOCATION:School hall\\, main entrance",
    "DESCRIPTION:<p>R/KS1 AM</p><p>KS2\u00a0PM</p><br />Forms due Monday",
  ]);
  assert.equal(
    week("2026-09-21", { wholeSchool }).text,
    [
      "*What's on this week (Mon 21 – Sun 27 Sep)*",
      "",
      "*Tue 22 Sep*",
      "• Nasal Flu Spray — Whole School",
      "  Location: School hall, main entrance",
      "  R/KS1 AM",
      "  KS2 PM",
      "  Forms due Monday",
    ].join("\n")
  );
});

test("folded lines are rejoined", () => {
  const wholeSchool = "BEGIN:VEVENT\r\nUID:stpauls-4@school-calendar-feed\r\nSUMMARY:Long \r\n title here\r\nDTSTART;VALUE=DATE:20260922\r\nEND:VEVENT";
  assert.match(week("2026-09-21", { wholeSchool }).text, /• Long title here/);
});

test("whole-school login lists only whole-school events, unmarked", () => {
  const wholeSchool = calendar(["UID:stpauls-5@school-calendar-feed", "SUMMARY:INSET DAY", "DTSTART;VALUE=DATE:20260902", "DTEND;VALUE=DATE:20260903"]);
  const { text } = buildWeekText({ calendarIcs: null, wholeSchoolIcs: wholeSchool, calendar: "whole-school", weekStart: "2026-08-31" });
  assert.match(text, /• INSET DAY$/);
});

test("within a day: all-day first, then by time", () => {
  const own = calendar(
    ["UID:a@x", `SUMMARY:${PREFIX}Evening`, "DTSTART;TZID=Europe/London:20260922T183000", "DTEND;TZID=Europe/London:20260922T193000"],
    ["UID:b@x", `SUMMARY:${PREFIX}Morning`, "DTSTART;TZID=Europe/London:20260922T083000", "DTEND;TZID=Europe/London:20260922T093000"],
    ["UID:c@x", `SUMMARY:${PREFIX}All day`, "DTSTART;VALUE=DATE:20260922", "DTEND;VALUE=DATE:20260923"]
  );
  const titles = week("2026-09-21", { own }).text.split("\n").filter((l) => l.startsWith("•"));
  assert.deepEqual(titles, ["• All day", "• 8:30am Morning", "• 6:30pm Evening"]);
});

test("the heading spans months when the week does", () => {
  assert.match(week("2026-09-28").text, /^\*What's on this week \(Mon 28 Sep – Sun 4 Oct\)\*/);
});

test("defaultWeekStart: Sunday looks ahead, other days use this week", () => {
  assert.equal(defaultWeekStart(new Date("2026-09-20T12:00:00Z")), "2026-09-21"); // Sun
  assert.equal(defaultWeekStart(new Date("2026-09-21T12:00:00Z")), "2026-09-21"); // Mon
  assert.equal(defaultWeekStart(new Date("2026-09-23T12:00:00Z")), "2026-09-21"); // Wed
  assert.equal(defaultWeekStart(new Date("2026-09-26T12:00:00Z")), "2026-09-21"); // Sat
});

test("defaultWeekStart uses the London date, not UTC", () => {
  // 23:30 UTC on Saturday is already Sunday 00:30 in London (BST).
  assert.equal(defaultWeekStart(new Date("2026-09-19T23:30:00Z")), "2026-09-21");
});

test("snapToMonday", () => {
  assert.equal(snapToMonday("2026-09-27"), "2026-09-21");
  assert.equal(snapToMonday("2026-09-21"), "2026-09-21");
});
