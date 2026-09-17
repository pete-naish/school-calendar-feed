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

// Flat list of every valid calendar, each with its year-group label attached
// (for grouping in the picker UI).
export const ALL_CALENDARS = [
  ...YEAR_GROUPS.flatMap((group) => group.classes.map((cls) => ({ ...cls, yearLabel: group.label }))),
  { ...FOSPS, yearLabel: "Friends of St Paul's" },
];

export function isValidCalendar(code) {
  return typeof code === "string" && ALL_CALENDARS.some((c) => c.code === code);
}
