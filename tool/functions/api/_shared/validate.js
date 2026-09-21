import { toTitleCase } from "./titleCase.js";
import { YEAR_GROUPS } from "./calendars.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECUR_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY"]);

// Caps on what one event can hold. The field lengths stop a single save
// bloating a data file (GitHub's Contents API only returns a file inline up to
// 1 MB, past which the tool couldn't read that calendar again - see also
// MAX_FILE_BYTES in github.js). The date limits keep an event to what the
// public page can cope with: it steps through every day of a multi-day event
// and every occurrence of a repeat in the visitor's browser, and a repeat that
// runs for centuries makes a huge .ics that every subscriber downloads. The
// page itself only looks 400 days ahead, hence `repeatDays`.
export const LIMITS = {
  title: 200,
  description: 2000,
  location: 200,
  url: 2000,
  exceptions: 100,
  eventsPerSave: 50,
  interval: 52,
  repeatDays: 400,
  spanDays: 90,
  minYear: 2000,
  maxYear: 2100,
};

function cleanOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// A location is a single line of plain text: whitespace runs (including any
// pasted newlines) collapse to one space. Also used for the Whole School
// location override (events-update.js).
export function cleanOptionalLocation(value) {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed || null;
}

function cleanOptionalTime(value) {
  return typeof value === "string" && TIME_RE.test(value) ? value : null;
}

// A YYYY-MM-DD that is also a real calendar day, in a sane range:
// "2026-02-30" has the right shape but isn't one (scripts/build_ics.py can't
// build an event on it), and "9999-12-31" is one no school calendar needs.
function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < LIMITS.minYear || year > LIMITS.maxYear) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// Whole days from one ISO date to a later one (both already known to be real).
function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function cleanOptionalDate(value) {
  return isRealDate(value) ? value : null;
}

// Rejects anything but http(s) - this value is later set as an <a href> on
// the public preview page (docs/assets/calendar.js), so a javascript: (or
// other) URL here would be a stored-XSS vector for every site visitor.
function cleanOptionalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  // Control characters (a pasted line break, say) are never part of a real
  // link, and one in the published .ics makes the whole feed fail to build.
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
}

// A recurring event with no end is a standing liability on a school calendar
// (terms end, teachers change) - require `until`, and drop the whole
// recurrence rather than publish an open-ended series. `until` must also fall
// within LIMITS.repeatDays of the event's first day. Returns
// { recurrence, error }: `recurrence` is null when there's none or it's
// unusable, and `error` says why when the rep asked for a repeat (freq set)
// that can't be kept.
function cleanRecurrence(value, startDate) {
  if (!value || typeof value !== "object" || !value.freq) return { recurrence: null, error: null };
  if (!RECUR_FREQ.has(value.freq)) return { recurrence: null, error: "A repeat must be daily, weekly or monthly" };
  const until = cleanOptionalDate(value.until);
  if (!until) return { recurrence: null, error: 'A repeating event needs an end date ("repeat until")' };
  if (until < startDate) return { recurrence: null, error: '"Repeat until" can\'t be before the event\'s date' };
  if (daysBetween(startDate, until) > LIMITS.repeatDays) {
    return {
      recurrence: null,
      error: `A repeating event can run for at most ${LIMITS.repeatDays} days - pick an earlier "repeat until" date`,
    };
  }
  const interval =
    Number.isInteger(value.interval) && value.interval > 0 && value.interval <= LIMITS.interval ? value.interval : 1;
  return { recurrence: { freq: value.freq, interval, until }, error: null };
}

const EXCEPTION_ACTIONS = new Set(["cancelled", "moved"]);

// Single-occurrence overrides on a recurring event (e.g. one week's PE
// clashes with something else and moves to Friday). Drops individual
// malformed entries rather than failing the whole event - a rep fixing
// one exception shouldn't lose every other exception on the card.
// Meaningless without `recurrence`, but harmless to carry through either
// way; scripts/build_ics.py only applies them when recurrence is present.
//
// An exception on a year group's shared event can be scoped to some of its
// classes with `classes` (class codes, e.g. ["rr"]); absent means every
// class. Unknown codes are dropped here - events-update.js narrows it to
// the caller's own year group, since this doesn't know which one that is.
const CLASS_CODES = new Set(YEAR_GROUPS.flatMap((group) => group.classes.map((cls) => cls.code)));

function cleanExceptionClasses(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((code) => typeof code === "string" && CLASS_CODES.has(code)))];
}

function cleanExceptions(value) {
  if (!Array.isArray(value)) return [];
  const cleaned = [];
  for (const item of value.slice(0, LIMITS.exceptions)) {
    if (!item || typeof item !== "object") continue;
    const date = cleanOptionalDate(item.date);
    if (!date || !EXCEPTION_ACTIONS.has(item.action)) continue;
    const classes = cleanExceptionClasses(item.classes);
    // A scope naming only unknown classes is bogus - drop the exception
    // rather than let it turn into a year-wide one.
    if (Array.isArray(item.classes) && item.classes.length > 0 && classes.length === 0) continue;
    const scope = classes.length > 0 ? { classes } : {};
    if (item.action === "cancelled") {
      cleaned.push({ date, action: "cancelled", ...scope });
      continue;
    }
    const new_date = cleanOptionalDate(item.new_date);
    if (!new_date) continue; // "moved" with no destination date isn't valid - drop it
    cleaned.push({
      date,
      action: "moved",
      new_date,
      new_time: cleanOptionalTime(item.new_time),
      new_end_time: cleanOptionalTime(item.new_end_time),
      ...scope,
    });
  }
  return cleaned;
}

function commonFields(item, recurrence) {
  return {
    time: cleanOptionalTime(item.time),
    end_time: cleanOptionalTime(item.end_time),
    description: cleanOptionalString(item.description),
    location: cleanOptionalLocation(item.location),
    url: cleanOptionalUrl(item.url),
    recurrence,
    exceptions: cleanExceptions(item.exceptions),
  };
}

// Shortens a too-long extracted value to `max` characters, ending in an
// ellipsis. Only for what the model extracted, which a rep then reviews - a
// value a rep typed themselves is rejected instead (lengthError below).
function clip(value, max) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

// The first field of an event that's over its length limit, as a message a
// rep can act on, or null.
function lengthError(fields) {
  const checks = [
    ["Title", fields.title, LIMITS.title],
    ["Description", fields.description, LIMITS.description],
    ["Location", fields.location, LIMITS.location],
    ["Link", fields.url, LIMITS.url],
  ];
  for (const [label, value, max] of checks) {
    if (value && value.length > max) return `${label} is too long (at most ${max} characters)`;
  }
  return null;
}

// Description/location edits on a school-sourced event (events-update.js) hold
// to the same limits. Returns a message, or null when both are fine.
export function overrideLengthError(changes) {
  return lengthError({ description: changes.description, location: changes.location });
}

// Validates/repairs the array of events Claude returned from record_events.
// Drops (rather than fails on) individual bad entries, so a single malformed
// event doesn't blank out an otherwise-good extraction.
export function validateExtractedEvents(input) {
  if (!input || !Array.isArray(input.events)) {
    return { events: [], warnings: ["The model didn't return an events list"] };
  }
  const warnings = [];
  const events = [];
  for (const item of input.events) {
    if (!item || typeof item.title !== "string" || !item.title.trim()) {
      warnings.push("Dropped an event with no title");
      continue;
    }
    if (!isRealDate(item.date)) {
      warnings.push(`Dropped "${item.title}" - couldn't resolve a date`);
      continue;
    }
    let end_date = cleanOptionalDate(item.end_date);
    if (end_date && end_date < item.date) {
      warnings.push(`"${item.title}" had an end date before its start date - ignored`);
      end_date = null;
    } else if (end_date && daysBetween(item.date, end_date) > LIMITS.spanDays) {
      warnings.push(`"${item.title}" ran for more than ${LIMITS.spanDays} days - its end date was ignored`);
      end_date = null;
    }
    const { recurrence, error: recurrenceError } = cleanRecurrence(item.recurrence, item.date);
    if (recurrenceError) warnings.push(`"${item.title}" - repeat ignored: ${recurrenceError}`);

    // Extracted titles are Title Case (see titleCase.js); a title a rep
    // types or edits themselves (validateEventInput below) is left as is.
    const event = {
      title: toTitleCase(item.title.trim()),
      date: item.date,
      end_date,
      ...commonFields(item, recurrence),
    };
    for (const [field, max] of [
      ["title", LIMITS.title],
      ["description", LIMITS.description],
      ["location", LIMITS.location],
    ]) {
      if (event[field] && event[field].length > max) {
        warnings.push(`"${event.title}" - its ${field} was shortened to ${max} characters`);
        event[field] = clip(event[field], max);
      }
    }
    if (event.url && event.url.length > LIMITS.url) event.url = null;
    events.push(event);
  }
  return { events, warnings };
}

// Validates a single event object submitted by the frontend (from the
// review form, either post-extraction, a manually-added card, or editing an
// already-saved event).
export function validateEventInput(event) {
  if (!event || typeof event.title !== "string" || !event.title.trim()) {
    return { valid: false, error: "Title is required" };
  }
  if (!isRealDate(event.date)) {
    return { valid: false, error: "A valid date (YYYY-MM-DD) is required" };
  }
  const end_date = cleanOptionalDate(event.end_date);
  if (end_date && end_date < event.date) {
    return { valid: false, error: "End date can't be before the start date" };
  }
  if (end_date && daysBetween(event.date, end_date) > LIMITS.spanDays) {
    return { valid: false, error: `An event can last at most ${LIMITS.spanDays} days` };
  }
  const { recurrence, error: recurrenceError } = cleanRecurrence(event.recurrence, event.date);
  if (recurrenceError) return { valid: false, error: recurrenceError };
  if (Array.isArray(event.exceptions) && event.exceptions.length > LIMITS.exceptions) {
    return { valid: false, error: `An event can have at most ${LIMITS.exceptions} exceptions` };
  }
  const title = event.title.trim();
  const common = commonFields(event, recurrence);
  const tooLong = lengthError({ title, ...common });
  if (tooLong) return { valid: false, error: tooLong };
  return { valid: true, event: { title, date: event.date, end_date, ...common } };
}
