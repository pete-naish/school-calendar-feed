import { isValidCalendar, isWholeSchoolCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateExtractedEvents } from "./_shared/validate.js";
import { getNextTermEndDate } from "./_shared/termEnd.js";

const MODEL = "claude-haiku-4-5";
const MAX_TEXT_LENGTH = 8000;

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode, text } = body || {};

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  if (!checkPasscode(env, calendar, passcode)) {
    return jsonResponse({ error: "invalid_passcode" }, 401);
  }
  // Whole School has nothing to extract into - this tool can only edit an
  // existing event's description there, never add new ones.
  if (isWholeSchoolCalendar(calendar)) {
    return jsonResponse(
      { error: "not_allowed", message: "Whole School events can't be added here - only their description and location can be edited." },
      403
    );
  }
  if (typeof text !== "string" || !text.trim()) {
    return jsonResponse({ error: "empty_text" }, 400);
  }

  const trimmedText = text.slice(0, MAX_TEXT_LENGTH);
  const now = new Date();
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  const todayReadable = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  let anthropicResp;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system:
          `You extract school/PTA calendar events from messy pasted text (WhatsApp messages, ` +
          `newsletters, PDF-extracted text). Today's date in London is ${todayIso} (${todayReadable}). ` +
          `Resolve relative dates ("next Tuesday", "Friday") and partial dates ("the 12th", no year) ` +
          `against today's date, in Europe/London time. If a date cannot be confidently resolved, omit ` +
          `that event rather than guessing. Extract every distinct event mentioned, even if several ` +
          `appear in one message. If an event clearly spans more than one day (e.g. "Monday to ` +
          `Wednesday", a residential trip), set end_date to its last day; otherwise leave end_date null. ` +
          `If the text explicitly states a repeating pattern (e.g. "every Thursday", "weekly", "every ` +
          `other Monday"), set recurrence.freq (DAILY/WEEKLY/MONTHLY) and recurrence.interval (2 for ` +
          `"every other/fortnightly", otherwise 1). Never set recurrence unless the text explicitly says ` +
          `the event repeats - do not assume a one-off event repeats just because it sounds routine. ` +
          `Never guess how long it repeats for - that is filled in separately; always leave recurrence.until unset. ` +
          `If the text says where an event takes place ("in the hall", "at the Rec"), set location to that ` +
          `place as short plain text; otherwise leave it null - never guess a location.`,
        messages: [{ role: "user", content: trimmedText }],
        tool_choice: { type: "tool", name: "record_events" },
        tools: [
          {
            name: "record_events",
            description: "Record the calendar events extracted from the pasted text.",
            input_schema: {
              type: "object",
              properties: {
                events: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD - the event's first/only day" },
                      end_date: {
                        type: ["string", "null"],
                        description: "ISO 8601 date - the event's last day, only if it spans multiple days, else null",
                      },
                      time: { type: ["string", "null"], description: "24h HH:MM, or null if all-day/unspecified" },
                      end_time: { type: ["string", "null"] },
                      description: { type: ["string", "null"] },
                      location: {
                        type: ["string", "null"],
                        description: "Where the event takes place, as short plain text, only if the text says so, else null",
                      },
                      url: { type: ["string", "null"] },
                      recurrence: {
                        type: ["object", "null"],
                        description:
                          "Set only if the text explicitly states a repeating pattern. Never set `until` - filled in separately.",
                        properties: {
                          freq: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"] },
                          interval: { type: "integer", description: "2 for \"every other\"/fortnightly, else 1" },
                        },
                      },
                    },
                    required: ["title", "date"],
                  },
                },
              },
              required: ["events"],
            },
          },
        ],
      }),
    });
  } catch (err) {
    return jsonResponse({ error: "extraction_failed", message: String(err) }, 502);
  }

  if (!anthropicResp.ok) {
    return jsonResponse({ error: "extraction_failed", message: await anthropicResp.text() }, 502);
  }

  const data = await anthropicResp.json();
  if (data.stop_reason !== "tool_use") {
    return jsonResponse(
      {
        error: "extraction_failed",
        message: "Couldn't extract events from that text - try pasting less at once, or add the event manually.",
      },
      502
    );
  }

  const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === "record_events");
  if (!toolUse) {
    return jsonResponse({ error: "extraction_failed", message: "Model did not return structured events." }, 502);
  }

  const rawEvents = Array.isArray(toolUse.input && toolUse.input.events) ? toolUse.input.events : [];

  // The model only ever detects the repeat *pattern* (freq/interval) - it
  // never invents an end date (see the system prompt above). Fill "until"
  // in here with a suggestion the rep still reviews/edits before saving:
  // the next published "Last Day of ... Term" date. One lookup per
  // request (not per event) using the earliest date that needs it, since
  // a single pasted message's events are almost always for the same term.
  const needsUntil = rawEvents.filter(
    (e) => e && e.recurrence && e.recurrence.freq && !e.recurrence.until && typeof e.date === "string"
  );
  if (needsUntil.length > 0) {
    const earliestDate = needsUntil.map((e) => e.date).sort()[0];
    const termEnd = await getNextTermEndDate(earliestDate);
    for (const item of needsUntil) {
      item.recurrence.until = termEnd;
    }
  }

  const { events, warnings } = validateExtractedEvents({ events: rawEvents });
  return jsonResponse({ events, warnings });
}
