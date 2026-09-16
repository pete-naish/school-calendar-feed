import { isValidCalendar } from "./_shared/calendars.js";
import { checkPasscode } from "./_shared/auth.js";
import { validateExtractedEvents } from "./_shared/validate.js";

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
          `appear in one message.`,
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
                      date: { type: "string", description: "ISO 8601 date, YYYY-MM-DD" },
                      time: { type: ["string", "null"], description: "24h HH:MM, or null if all-day/unspecified" },
                      end_time: { type: ["string", "null"] },
                      description: { type: ["string", "null"] },
                      url: { type: ["string", "null"] },
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

  const { events, warnings } = validateExtractedEvents(toolUse.input);
  return jsonResponse({ events, warnings });
}
