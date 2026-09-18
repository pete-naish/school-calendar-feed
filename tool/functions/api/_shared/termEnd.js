// Looks up a sensible default "repeat until" date for a newly-detected
// recurring event, by finding the next "Last Day of ... Term" event in the
// site's own already-published whole-school calendar - the same feed
// anyone can already subscribe to, fetched here as a plain public URL (no
// auth needed). This is only ever a *suggestion* the rep reviews/edits
// before saving; it's never invented by the LLM itself (see parse.js).

const WHOLE_SCHOOL_ICS_URL = "https://pete-naish.github.io/school-calendar-feed/calendars/whole-school.ics";
const FALLBACK_HORIZON_DAYS = 84; // ~12 weeks - used if no term-end event is found (or the fetch fails)
const TERM_END_PATTERN = /last day of.*term/i;

// Splits on VEVENT boundaries and reads SUMMARY/DTSTART independently per
// block, rather than assuming a fixed property order - more robust than a
// single regex over the whole file, and needs no real ICS parser.
function extractTitledDates(icsText) {
  const blocks = icsText.split("BEGIN:VEVENT").slice(1);
  const events = [];
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const summaryMatch = body.match(/\nSUMMARY:([^\r\n]*)/);
    const dtstartMatch = body.match(/\nDTSTART[^:]*:(\d{8})/);
    if (!summaryMatch || !dtstartMatch) continue;
    const d = dtstartMatch[1];
    events.push({
      summary: summaryMatch[1].trim(),
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    });
  }
  return events;
}

function fallbackDate(afterDateIso) {
  const d = new Date(`${afterDateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + FALLBACK_HORIZON_DAYS);
  return d.toISOString().slice(0, 10);
}

// Returns an ISO date - the earliest "Last Day of ... Term" event on or
// after afterDateIso, or a fixed fallback horizon if none is found/the
// fetch fails. Never throws.
export async function getNextTermEndDate(afterDateIso) {
  try {
    const resp = await fetch(WHOLE_SCHOOL_ICS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!resp.ok) return fallbackDate(afterDateIso);
    const text = await resp.text();
    const candidates = extractTitledDates(text)
      .filter((e) => TERM_END_PATTERN.test(e.summary) && e.date >= afterDateIso)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return candidates.length > 0 ? candidates[0].date : fallbackDate(afterDateIso);
  } catch {
    return fallbackDate(afterDateIso);
  }
}
