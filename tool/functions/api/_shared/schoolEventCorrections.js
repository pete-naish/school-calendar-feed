// Persists date/time corrections for school-sourced events the school's own
// calendar has wrong (half term entered a day late, a service ending at the
// wrong time) to data/school_event_corrections.json, which
// scripts/build_ics.py lays over the school's event before anything else
// reads it - so a correction changes the event in every feed it's in, and
// for a closure day also which days recurring class events skip.
//
// {"<school event id>": {"start", "end", "school_start", "school_end", "note", "by"}}:
// all-day `start`/`end` are "YYYY-MM-DD" with `end` the LAST day (inclusive);
// timed ones are London-local "YYYY-MM-DDTHH:MM". `school_start`/`school_end`
// are what the school's calendar said when the correction was made, so the
// build can tell when the school later changes the event itself (it then
// drops the correction - see prune_school_event_corrections()). `note` is the
// rep's reason, `by` the calendar whose passcode made it. Entries written by
// hand may have only some of these.
import { commitJsonFile } from "./github.js";
import { isSchoolEventId } from "./wholeSchoolOverrides.js";
import { isoToDay, dayToIso, londonDayAndTime } from "./ics.js";

export const CORRECTIONS_PATH = "data/school_event_corrections.json";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;
export const NOTE_MIN_LENGTH = 5;
export const NOTE_MAX_LENGTH = 300;
// How far ahead a corrected date may be - the school's feed only reaches a
// year ahead anyway, so anything much further is a typo.
const MAX_DAYS_AHEAD = 400;

function isRealDate(iso) {
  return DATE.test(iso) && dayToIso(isoToDay(iso)) === iso;
}

export function todayLondon() {
  return dayToIso(londonDayAndTime(new Date()).day);
}

// A published school event's own dates/times in the file's format, or null
// for a timed event that runs over more than one day (which the tool doesn't
// correct - its end time isn't a same-day one).
export function schoolSpan(event) {
  if (!event.time) return { start: event.date, end: event.end_date || event.date };
  if (!event.end_time) return null;
  return { start: `${event.date}T${event.time}`, end: `${event.date}T${event.end_time}` };
}

// Checks a rep's {start, end, note} against the event it's for. Returns
// { correction } or { error } with a message a rep can act on.
export function validateCorrection(event, input, today = todayLondon()) {
  if (!input || typeof input !== "object") return { error: "Missing the corrected date." };
  if (!schoolSpan(event)) {
    return { error: "This event runs over more than one day, so its times can't be corrected here - ask Pete." };
  }
  if ((event.end_date || event.date) < today) return { error: "That event has already happened." };

  const { start, end } = input;
  const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim() : "";
  if (note.length < NOTE_MIN_LENGTH) {
    return { error: "Say how you know the right date or time (e.g. \"Newsletter 25 Sep\")." };
  }
  if (note.length > NOTE_MAX_LENGTH) return { error: `Keep the reason under ${NOTE_MAX_LENGTH} characters.` };
  if (typeof start !== "string" || typeof end !== "string") return { error: "Missing the corrected date." };

  let firstDay;
  if (!event.time) {
    if (!isRealDate(start) || !isRealDate(end)) return { error: "That isn't a valid date." };
    if (end < start) return { error: "The last day can't be before the first day." };
    firstDay = start;
  } else {
    const s = start.match(DATE_TIME);
    const e = end.match(DATE_TIME);
    if (!s || !e || !isRealDate(s[1])) return { error: "That isn't a valid date and time." };
    if (s[1] !== e[1]) return { error: "The start and end must be on the same day." };
    if (e[2] <= s[2]) return { error: "The end time must be after the start time." };
    firstDay = s[1];
  }
  if (firstDay < today) return { error: "The corrected date can't be in the past." };
  if (isoToDay(firstDay) - isoToDay(today) > MAX_DAYS_AHEAD) {
    return { error: "That date is more than a year away - check the year." };
  }
  return { correction: { start, end, note } };
}

// Dates/times in the file's format, as the tool's event fields.
function spanFields(start, end, allDay) {
  if (allDay) return { date: start, end_date: end || start, time: null, end_time: null };
  const fields = {};
  const s = typeof start === "string" && start.match(DATE_TIME);
  const e = typeof end === "string" && end.match(DATE_TIME);
  if (s) Object.assign(fields, { date: s[1], time: s[2] });
  if (e) Object.assign(fields, { end_date: e[1], end_time: e[2] });
  return fields;
}

// The events with any saved correction laid over them - a pending one (saved
// but not yet built) shows straight away, and one that's already built is
// unchanged by it - plus a `correction` saying so: the rep's note, and what
// the school's calendar says (null for a hand-written entry that didn't
// record it). A correction whose shape doesn't match the event is ignored,
// as the build ignores it.
export function applyCorrections(events, corrections) {
  return events.map((e) => {
    const entry = corrections[e.id];
    if (!entry || typeof entry !== "object") return e;
    const allDay = !e.time;
    const values = [entry.start, entry.end].filter((v) => typeof v === "string");
    if (values.some((v) => (allDay ? !DATE.test(v) : !DATE_TIME.test(v)))) return e;

    const corrected = { ...e, ...spanFields(entry.start, entry.end, allDay) };
    if (allDay && typeof entry.end !== "string") corrected.end_date = corrected.date;
    if (corrected.time && corrected.end_date !== corrected.date) corrected.end_time = null;
    const school =
      typeof entry.school_start === "string" ? spanFields(entry.school_start, entry.school_end, allDay) : null;
    return {
      ...corrected,
      correction: { note: typeof entry.note === "string" ? entry.note : "", school },
    };
  });
}

// Saves `correction` ({start, end, note}, already validated) for school event
// `id`, or with null removes it (back to the school's own dates). `school` is
// the published event's span (schoolSpan()), recorded only when the event
// has no correction yet - once it has one, what's published is the corrected
// value, so an existing entry's recorded school values are kept instead (and
// a hand-written entry without them stays without). A correction back to
// exactly what the school says is the same as removing it.
export async function commitSchoolEventCorrection(env, id, correction, { school, by, label }) {
  if (!isSchoolEventId(id)) return { error: "invalid_id", message: "That isn't a school event id." };
  const message = correction
    ? `Correct date of ${label} (${id}): ${correction.note}`
    : `Undo date correction of ${label} (${id})`;
  return commitJsonFile(
    env,
    CORRECTIONS_PATH,
    {},
    async (corrections) => {
      const updated = { ...corrections };
      const existing = updated[id];
      if (!correction) {
        if (!existing) return { error: "not_found", message: "That event has no date correction to undo." };
        delete updated[id];
        return { data: updated };
      }
      const recorded = existing
        ? typeof existing.school_start === "string"
          ? { school_start: existing.school_start, school_end: existing.school_end }
          : {}
        : { school_start: school.start, school_end: school.end };
      if (recorded.school_start === correction.start && recorded.school_end === correction.end) {
        delete updated[id];
      } else {
        updated[id] = { start: correction.start, end: correction.end, ...recorded, note: correction.note, by };
      }
      return { data: updated };
    },
    message
  );
}
