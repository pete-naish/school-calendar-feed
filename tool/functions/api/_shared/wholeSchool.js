// Lists whole-school events for the restricted "Whole School" calendar
// entry (description-editing only - see calendars.js) by reading the
// site's own already-published whole-school.ics, the same public-URL
// approach termEnd.js already uses - avoids re-implementing
// scripts/build_ics.py's classify_event() a second time in JS just to ask
// "which events are whole-school".
//
// Each event's `id` is the school API's own event id, recovered from the
// UID scripts/build_ics.py assigns it (`stpauls-<id>@school-calendar-feed`)
// - stable across rebuilds, and what description/location overrides are
// keyed by (see wholeSchoolOverrides.js).

const WHOLE_SCHOOL_ICS_URL = "https://pete-naish.github.io/school-calendar-feed/calendars/whole-school.ics";
const UID_PATTERN = /^stpauls-(\d+)@school-calendar-feed$/;

function unescapeIcsText(text) {
  return text.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// Splits on VEVENT boundaries and reads each property independently per
// block (not assuming a fixed property order), same approach as
// termEnd.js. DESCRIPTION is the one property here long enough to need
// RFC 5545 line-unfolding (a folded continuation line starts with exactly
// one space, which must be stripped when rejoining) - as is LOCATION, once
// an override has given the event one.
function extractEvents(icsText) {
  const blocks = icsText.split("BEGIN:VEVENT").slice(1);
  const events = [];
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const uidMatch = body.match(/\nUID:([^\r\n]*)/);
    const summaryMatch = body.match(/\nSUMMARY:([^\r\n]*)/);
    const dtstartMatch = body.match(/\nDTSTART[^:]*:(\d{8})/);
    const descMatch = body.match(/\nDESCRIPTION:([^\r\n]*(?:\r?\n [^\r\n]*)*)/);
    const locationMatch = body.match(/\nLOCATION:([^\r\n]*(?:\r?\n [^\r\n]*)*)/);
    if (!uidMatch || !summaryMatch || !dtstartMatch) continue;

    const idMatch = uidMatch[1].trim().match(UID_PATTERN);
    if (!idMatch) continue; // not a school-API-sourced event - shouldn't happen in whole-school.ics

    const d = dtstartMatch[1];
    events.push({
      id: idMatch[1],
      title: unescapeIcsText(summaryMatch[1].trim()),
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      description: descMatch ? unescapeIcsText(descMatch[1].replace(/\r?\n /g, "")) : "",
      location: locationMatch ? unescapeIcsText(locationMatch[1].replace(/\r?\n /g, "")) : "",
    });
  }
  return events;
}

export async function fetchWholeSchoolEvents() {
  // No cf.cacheTtl here (unlike termEnd.js's 1hr cache) - a rep loading
  // this page wants to see genuinely current events/descriptions, not a
  // stale edge-cached copy from earlier in the day.
  const resp = await fetch(WHOLE_SCHOOL_ICS_URL);
  if (!resp.ok) throw new Error(`Fetch whole-school.ics failed: ${resp.status}`);
  const text = await resp.text();
  return extractEvents(text).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
