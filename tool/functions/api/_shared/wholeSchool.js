// Lists school-sourced events - those from the school's own Upcoming Events
// feed, as opposed to manual ones - by reading the site's own
// already-published .ics files, the same public-URL approach termEnd.js
// already uses. That avoids re-implementing scripts/build_ics.py's
// classify_event() a second time in JS just to ask "which events are
// whole-school / which are this class's".
//
// Two callers: the restricted "Whole School" calendar entry (whole-school.ics,
// description/location editing only - see calendars.js) and each class's own
// entry, which lists the school events classify_event() routed to that class
// alongside its manual ones (class .ics files mix the two, told apart by UID).
//
// Each event's `id` is the school API's own event id, recovered from the
// UID scripts/build_ics.py assigns it (`stpauls-<id>@school-calendar-feed`)
// - stable across rebuilds, and what description/location overrides are
// keyed by (see wholeSchoolOverrides.js).

const CALENDARS_URL = "https://pete-naish.github.io/school-calendar-feed/calendars";
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
    if (!idMatch) continue; // not a school-API-sourced event (e.g. a manual one in a class feed)

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

async function fetchSchoolEvents(icsFile, { titlePrefix = "" } = {}) {
  // No cf.cacheTtl here (unlike termEnd.js's 1hr cache) - a rep loading
  // this page wants to see genuinely current events/descriptions, not a
  // stale edge-cached copy from earlier in the day.
  const resp = await fetch(`${CALENDARS_URL}/${icsFile}`);
  if (!resp.ok) throw new Error(`Fetch ${icsFile} failed: ${resp.status}`);
  const text = await resp.text();
  return extractEvents(text)
    .map((e) => (titlePrefix && e.title.startsWith(titlePrefix) ? { ...e, title: e.title.slice(titlePrefix.length) } : e))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function fetchWholeSchoolEvents() {
  return fetchSchoolEvents("whole-school.ics");
}

// A class's own school-sourced events, with the "<CODE>: " prefix
// build_event() adds to every class-calendar title taken back off (the tool
// already says which calendar you're in).
export function fetchClassSchoolEvents(classCode) {
  return fetchSchoolEvents(`${classCode}.ics`, { titlePrefix: `${classCode.toUpperCase()}: ` });
}
