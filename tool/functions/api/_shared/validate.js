const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanOptionalTime(value) {
  return typeof value === "string" && TIME_RE.test(value) ? value : null;
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
    events.push({
      title: item.title.trim(),
      date: item.date,
      time: cleanOptionalTime(item.time),
      end_time: cleanOptionalTime(item.end_time),
      description: cleanOptionalString(item.description),
      url: cleanOptionalString(item.url),
    });
  }
  return { events, warnings };
}

// Validates a single event object submitted by the frontend (from the
// review form, either post-extraction or when editing a saved event).
export function validateEventInput(event) {
  if (!event || typeof event.title !== "string" || !event.title.trim()) {
    return { valid: false, error: "Title is required" };
  }
  if (typeof event.date !== "string" || !DATE_RE.test(event.date)) {
    return { valid: false, error: "A valid date (YYYY-MM-DD) is required" };
  }
  return {
    valid: true,
    event: {
      title: event.title.trim(),
      date: event.date,
      time: cleanOptionalTime(event.time),
      end_time: cleanOptionalTime(event.end_time),
      description: cleanOptionalString(event.description),
      url: cleanOptionalString(event.url),
    },
  };
}
