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
      { code: "rr", label: "RR" },
      { code: "rgp", label: "RGP" },
    ],
  },
  {
    key: "year1",
    label: "Year 1",
    classes: [
      { code: "1ms", label: "1MS" },
      { code: "1t", label: "1T" },
    ],
  },
  {
    key: "year2",
    label: "Year 2",
    classes: [
      { code: "2ly", label: "2LY" },
      { code: "2s", label: "2S" },
    ],
  },
  {
    key: "year3",
    label: "Year 3",
    classes: [
      { code: "3b", label: "3B" },
      { code: "3d", label: "3D" },
    ],
  },
  {
    key: "year4",
    label: "Year 4",
    classes: [
      { code: "4m", label: "4M" },
      { code: "4w", label: "4W" },
    ],
  },
  {
    key: "year5",
    label: "Year 5",
    classes: [
      { code: "5l", label: "5L" },
      { code: "5hp", label: "5HP" },
    ],
  },
  {
    key: "year6",
    label: "Year 6",
    classes: [
      { code: "6bt", label: "6BT" },
      { code: "6r", label: "6R" },
    ],
  },
];

export const FOSPS = { code: "fosps", label: "FOSPS" };

// A restricted calendar entry, not one of the 14 classes/FOSPS above: lets
// someone with its passcode edit the *description* of an already-published
// whole-school event (e.g. adding parking/kit notes to an inset day), and
// nothing else - no adding/deleting events, no editing title/date/etc. See
// tool/README.md and _shared/wholeSchool.js / _shared/wholeSchoolOverrides.js.
export const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };

// Flat list of every valid calendar, each with its year-group label attached
// (for grouping in the picker UI).
export const ALL_CALENDARS = [
  { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
  ...YEAR_GROUPS.flatMap((group) => group.classes.map((cls) => ({ ...cls, yearLabel: group.label }))),
  { ...FOSPS, yearLabel: "Friends of St Paul's" },
];

export function isValidCalendar(code) {
  return typeof code === "string" && ALL_CALENDARS.some((c) => c.code === code);
}

// The whole-school entry above only allows editing an event's description -
// every other action (add/delete, editing title/date/recurrence/etc) is
// disabled both in the UI and re-checked server-side in each endpoint.
export function isDescriptionOnlyCalendar(code) {
  return code === WHOLE_SCHOOL.code;
}
