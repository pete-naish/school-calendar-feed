// The year groups and their classes - the single source of truth for class
// codes and labels. Read by scripts/build_ics.py (feeds), docs/assets/calendar.js
// (the parent page) and tool/functions/api/_shared/calendars.js (the class rep
// tool, which serves it to its page from GET /api/calendars).
//
// To relabel a class (a new teacher, a new school year), change its "label".
// Never change a "code": it's the feed URL, the rep's passcode key and the data
// file name. Everything after `export default` must stay strict JSON (double
// quotes, no comments, no trailing commas) - the Python build parses it as JSON.
// It's a JS module rather than a .json file because Cloudflare's bundler and
// Node disagree on how to import JSON.
export default {
  "yearGroups": [
    {
      "key": "reception",
      "label": "Reception",
      "number": "R",
      "classes": [
        { "code": "rec-a", "label": "RR" },
        { "code": "rec-b", "label": "RGP" }
      ]
    },
    {
      "key": "year1",
      "label": "Year 1",
      "number": "1",
      "classes": [
        { "code": "y1-a", "label": "1S" },
        { "code": "y1-b", "label": "1T" }
      ]
    },
    {
      "key": "year2",
      "label": "Year 2",
      "number": "2",
      "classes": [
        { "code": "y2-a", "label": "2L" },
        { "code": "y2-b", "label": "2MS" }
      ]
    },
    {
      "key": "year3",
      "label": "Year 3",
      "number": "3",
      "classes": [
        { "code": "y3-a", "label": "3B" },
        { "code": "y3-b", "label": "3D" }
      ]
    },
    {
      "key": "year4",
      "label": "Year 4",
      "number": "4",
      "classes": [
        { "code": "y4-a", "label": "4W" },
        { "code": "y4-b", "label": "4Y" }
      ]
    },
    {
      "key": "year5",
      "label": "Year 5",
      "number": "5",
      "classes": [
        { "code": "y5-a", "label": "5HP" },
        { "code": "y5-b", "label": "5M" }
      ]
    },
    {
      "key": "year6",
      "label": "Year 6",
      "number": "6",
      "classes": [
        { "code": "y6-a", "label": "6L" },
        { "code": "y6-b", "label": "6R" }
      ]
    }
  ]
};
