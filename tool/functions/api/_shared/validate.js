const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECUR_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY"]);

function cleanOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanOptionalTime(value) {
  return typeof value === "string" && TIME_RE.test(value) ? value : null;
}

function cleanOptionalDate(value) {
  return typeof value === "string" && DATE_RE.test(value) ? value : null;
}

// Rejects anything but http(s) - this value is later set as an <a href> on
// the public preview page (docs/assets/calendar.js), so a javascript: (or
// other) URL here would be a stored-XSS vector for every site visitor.
function cleanOptionalUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
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
// recurrence rather than publish an open-ended series.
function cleanRecurrence(value) {
  if (!value || typeof value !== "object" || !RECUR_FREQ.has(value.freq)) return null;
  const until = cleanOptionalDate(value.until);
  if (!until) return null;
  const interval = Number.isInteger(value.interval) && value.interval > 0 ? value.interval : 1;
  return { freq: value.freq, interval, until };
}

const EXCEPTION_ACTIONS = new Set(["cancelled", "moved"]);

// Single-occurrence overrides on a recurring event (e.g. one week's PE
// clashes with something else and moves to Friday). Drops individual
// malformed entries rather than failing the whole event - a rep fixing
// one exception shouldn't lose every other exception on the card.
// Meaningless without `recurrence`, but harmless to carry through either
// way; scripts/build_ics.py only applies them when recurrence is present.
function cleanExceptions(value) {
  if (!Array.isArray(value)) return [];
  const cleaned = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const date = cleanOptionalDate(item.date);
    if (!date || !EXCEPTION_ACTIONS.has(item.action)) continue;
    if (item.action === "cancelled") {
      cleaned.push({ date, action: "cancelled" });
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
    });
  }
  return cleaned;
}

function commonFields(item) {
  return {
    time: cleanOptionalTime(item.time),
    end_time: cleanOptionalTime(item.end_time),
    description: cleanOptionalString(item.description),
    url: cleanOptionalUrl(item.url),
    recurrence: cleanRecurrence(item.recurrence),
    exceptions: cleanExceptions(item.exceptions),
  };
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
    if (typeof item.date !== "string" || !DATE_RE.test(item.date)) {
      warnings.push(`Dropped "${item.title}" - couldn't resolve a date`);
      continue;
    }
    let end_date = cleanOptionalDate(item.end_date);
    if (end_date && end_date < item.date) {
      warnings.push(`"${item.title}" had an end date before its start date - ignored`);
      end_date = null;
    }
    events.push({
      title: item.title.trim(),
      date: item.date,
      end_date,
      ...commonFields(item),
    });
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
  if (typeof event.date !== "string" || !DATE_RE.test(event.date)) {
    return { valid: false, error: "A valid date (YYYY-MM-DD) is required" };
  }
  const end_date = cleanOptionalDate(event.end_date);
  if (end_date && end_date < event.date) {
    return { valid: false, error: "End date can't be before the start date" };
  }
  const recurrence = event.recurrence ? cleanRecurrence(event.recurrence) : null;
  if (event.recurrence && event.recurrence.freq && !recurrence) {
    return { valid: false, error: "A repeating event needs an end date (\"repeat until\")" };
  }
  return {
    valid: true,
    event: {
      title: event.title.trim(),
      date: event.date,
      end_date,
      ...commonFields(event),
    },
  };
}
