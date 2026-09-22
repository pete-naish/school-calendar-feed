// Mirrors YEAR_GROUPS in scripts/build_ics.py - keep the two in sync by hand
// (no shared build step between the Python script and this JS tool;
// scripts/check_config_sync.py checks this on every push).
//
// `code` is the permanent identifier - it matches docs/calendars/<code>.ics
// and data/manual_events/<code>.json, and must never change. `label` is
// what's shown to reps in the picker and can be updated any time the school
// relabels a class (see scripts/build_ics.py's `current_label` for the
// equivalent on the .ics-generation side).
export const YEAR_GROUPS = [
  {
    key: "reception",
    label: "Reception",
    classes: [
      { code: "rec-a", label: "RR" },
      { code: "rec-b", label: "RGP" },
    ],
  },
  {
    key: "year1",
    label: "Year 1",
    classes: [
      { code: "y1-a", label: "1S" },
      { code: "y1-b", label: "1T" },
    ],
  },
  {
    key: "year2",
    label: "Year 2",
    classes: [
      { code: "y2-a", label: "2L" },
      { code: "y2-b", label: "2MS" },
    ],
  },
  {
    key: "year3",
    label: "Year 3",
    classes: [
      { code: "y3-a", label: "3B" },
      { code: "y3-b", label: "3D" },
    ],
  },
  {
    key: "year4",
    label: "Year 4",
    classes: [
      { code: "y4-a", label: "4W" },
      { code: "y4-b", label: "4Y" },
    ],
  },
  {
    key: "year5",
    label: "Year 5",
    classes: [
      { code: "y5-a", label: "5HP" },
      { code: "y5-b", label: "5M" },
    ],
  },
  {
    key: "year6",
    label: "Year 6",
    classes: [
      { code: "y6-a", label: "6L" },
      { code: "y6-b", label: "6R" },
    ],
  },
];

export const FOSPS = { code: "fosps", label: "FOSPS" };

// A restricted calendar entry, not one of the 14 classes/FOSPS above: lets
// someone with its passcode edit the *description* and *location* of an
// already-published whole-school event (e.g. adding parking/kit notes to an
// inset day, or where a service is held), and nothing else - no
// adding/deleting events, no editing title/date/etc. See
// tool/README.md and _shared/wholeSchool.js / _shared/wholeSchoolOverrides.js.
export const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };

// Flat list of every valid calendar, each with its year-group label attached
// (for grouping in the picker UI).
export const ALL_CALENDARS = [
  { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
  ...YEAR_GROUPS.flatMap((group) => group.classes.map((cls) => ({ ...cls, yearLabel: group.label }))),
  { ...FOSPS, yearLabel: "Friends of St Paul's" },
];

// The "5HP: " a calendar's event titles start with in its published feed (see
// class_prefix() in scripts/build_ics.py): its label - what the school calls
// the class - not its permanent code ("y5-a"). For stripping it back off.
export function titlePrefixFor(code) {
  const entry = ALL_CALENDARS.find((c) => c.code === code);
  return `${entry ? entry.label : String(code).toUpperCase()}: `;
}

// The year group a class calendar belongs to, or null for FOSPS / Whole
// School. An event added for "all of Year 1" is stored once, in
// data/manual_events/<group.key>.json (e.g. year1.json), and
// scripts/build_ics.py builds it into every class of that year.
export function yearGroupFor(code) {
  return YEAR_GROUPS.find((group) => group.classes.some((cls) => cls.code === code)) || null;
}

export function isValidCalendar(code) {
  return typeof code === "string" && ALL_CALENDARS.some((c) => c.code === code);
}

// The whole-school entry above only allows editing an event's description and
// location - every other action (add/delete, editing title/date/recurrence/etc) is
// disabled both in the UI and re-checked server-side in each endpoint.
export function isWholeSchoolCalendar(code) {
  return code === WHOLE_SCHOOL.code;
}
