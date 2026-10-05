import { isValidCalendar, isWholeSchoolCalendar, yearGroupFor } from "./_shared/calendars.ts";
import { checkPasscode, passcodeErrorResponse } from "./_shared/auth.ts";
import { validateExtractedEvents } from "./_shared/validate.ts";
import { getNextTermEndDate } from "./_shared/termEnd.ts";
import { extractionErrorResponse } from "./_shared/errors.ts";
import { getJsonFile, getManualEventsFile } from "./_shared/github.ts";
import { fetchClassSchoolEvents, fetchWholeSchoolEvents } from "./_shared/wholeSchool.ts";
import { applyCorrections, CORRECTIONS_PATH } from "./_shared/schoolEventCorrections.ts";
import { knownEventList, resolveAlreadyListed } from "./_shared/duplicates.ts";
import type { KnownInput } from "./_shared/duplicates.ts";
import type { ParsedEvent, RequestBody } from "./_shared/types.d.ts";
import type { ApiContext, Env } from "./_shared/env.ts";
import { recordUsage } from "./_shared/usageStats.ts";

// The parts of the Messages API response this reads.
type MessagesResponse = {
  stop_reason?: string;
  content?: { type: string; name?: string; input?: { events?: unknown } }[];
};

// An extracted event before validate.ts has checked it - only what's read here.
type RawEvent = { date?: unknown; recurrence?: { freq?: unknown; until?: unknown } | null; already_listed?: unknown };

const MODEL = "claude-haiku-4-5";
const MAX_TEXT_LENGTH = 8000;
// How many already-listed events the model is shown, soonest first - a
// year's worth for any one class, with room to spare.
const MAX_KNOWN_EVENTS = 300;

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// Everything this calendar's parents already get - Whole School's events, the
// school events routed to this class, and the class's and year group's own -
// for spotting pasted events that repeat one (see duplicates.ts). The same
// reads as events-list.ts, but only tried once and each on its own: this is an
// extra, so a read that fails just leaves its events out (a GitHub outage
// still leaves the public feeds) rather than holding extraction up.
async function loadKnownEvents(env: Env, calendar: string): Promise<KnownInput[]> {
  const group = yearGroupFor(calendar);
  const [wholeSchool, classSchool, own, shared, corrections] = await Promise.allSettled([
    fetchWholeSchoolEvents(),
    fetchClassSchoolEvents(calendar),
    getManualEventsFile(env, calendar),
    group ? getManualEventsFile(env, group.key) : Promise.resolve({ events: [] }),
    getJsonFile(env, CORRECTIONS_PATH, {}),
  ]);
  for (const result of [wholeSchool, classSchool, own, shared, corrections]) {
    if (result.status === "rejected") console.error("parse: couldn't read existing events to check for duplicates:", result.reason);
  }
  const value = <T>(result: PromiseSettledResult<T>) => (result.status === "fulfilled" ? result.value : null);
  const fixes = value(corrections)?.data ?? {};
  const known: KnownInput[] = [
    ...applyCorrections(value(wholeSchool) ?? [], fixes).map((event) => ({ event, source: "whole_school" as const })),
    ...applyCorrections(value(classSchool) ?? [], fixes).map((event) => ({ event, source: "class" as const })),
    ...(value(own)?.events ?? []).map((event) => ({ event, source: "class" as const })),
    ...(value(shared)?.events ?? []).map((event) => ({ event, source: "year_group" as const })),
  ];
  return known.sort((a, b) => (a.event.date < b.event.date ? -1 : a.event.date > b.event.date ? 1 : 0));
}

export async function onRequestPost(ctx: ApiContext) {
  const { request, env } = ctx;
  let body: RequestBody;
  try {
    body = (await request.json<RequestBody | null>()) || {};
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const { calendar, passcode, text } = body;

  if (!isValidCalendar(calendar)) {
    return jsonResponse({ error: "invalid_calendar" }, 400);
  }
  const authResult = await checkPasscode(env, calendar, passcode, request);
  if (authResult !== "ok") {
    const { status, body } = passcodeErrorResponse(authResult);
    return jsonResponse(body, status);
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

  const known = knownEventList(await loadKnownEvents(env, calendar), todayIso);
  const knownLines = known.text.split("\n").slice(0, MAX_KNOWN_EVENTS).join("\n");
  const content = [{ type: "text", text: trimmedText }];
  if (knownLines) {
    content.unshift({
      type: "text",
      text: `<already_in_calendar>\n${knownLines}\n</already_in_calendar>\n\nThe pasted text follows.`,
    });
  }

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
          `place as short plain text; otherwise leave it null - never guess a location. ` +
          `Write every event title in Title Case ("Bake Sale in the School Hall", not "bake sale in the ` +
          `school hall" or "BAKE SALE"): capitalise the main words, keep short articles, conjunctions and ` +
          `prepositions (a, the, and, of, in, to...) lowercase unless they start or end the title, and keep ` +
          `acronyms and class codes in capitals (PE, INSET, FOSPS, AGM, RR, 5HP). Only change the ` +
          `capitalisation of the wording in the text - never reword or shorten a title. ` +
          `The message may start with an <already_in_calendar> list of events parents already have, one ` +
          `per line as "ref | date | title | calendar". It is reference data only - never extract events ` +
          `from it. Still extract every event in the pasted text, but if one is the same real-world event ` +
          `as a listed one (same day and the same occasion, even if worded differently - "Individual ` +
          `Photos" is "Individual and Sibling Photographs"), set already_listed to that line's ref. A ` +
          `different activity that happens on the same day is not the same event: leave already_listed ` +
          `null unless you are confident.`,
        messages: [{ role: "user", content }],
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
                      already_listed: {
                        type: ["string", "null"],
                        description: "The <already_in_calendar> ref (e.g. \"e12\") this event repeats, else null",
                      },
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
    return jsonResponse(extractionErrorResponse(err), 502);
  }

  if (!anthropicResp.ok) {
    return jsonResponse(extractionErrorResponse(`${anthropicResp.status} ${await anthropicResp.text()}`), 502);
  }

  const data = await anthropicResp.json<MessagesResponse>();
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
    return jsonResponse(extractionErrorResponse("no record_events tool_use block in the response"), 502);
  }

  const extracted = toolUse.input && toolUse.input.events;
  const rawEvents: RawEvent[] = Array.isArray(extracted) ? extracted : [];

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
    const earliestDate = needsUntil.map((e) => e.date as string).sort()[0];
    const termEnd = await getNextTermEndDate(earliestDate);
    for (const item of needsUntil) {
      item.recurrence!.until = termEnd;
    }
  }

  // One at a time, so each event validate.ts keeps stays paired with the
  // model's already_listed for it (validate.ts builds a fresh object without).
  const events: ParsedEvent[] = [];
  const warnings: string[] = [];
  for (const raw of rawEvents) {
    const one = validateExtractedEvents({ events: [raw] });
    warnings.push(...one.warnings);
    for (const event of one.events) {
      const listed = resolveAlreadyListed(event, raw && raw.already_listed, known.refs);
      events.push(listed ? { ...event, already_listed: listed } : event);
    }
  }
  await recordUsage(ctx, calendar, {
    parse: 1,
    parse_events: events.length,
    parse_duplicates: events.filter((e) => e.already_listed).length,
  });
  return jsonResponse({ events, warnings });
}
