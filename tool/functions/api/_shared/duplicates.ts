// Spotting pasted events that are already in the calendar. A class newsletter
// often repeats whole-school events ("Individual photos on Wednesday") that a
// class rep can't see from their own login, and save.ts's exact title+date
// dedupe can't catch them - the school words them differently ("Individual
// and Sibling photographs") and they live in another feed.
//
// So parse.ts hands the model a numbered list of what this class's parents
// already get (knownEventList), the model points an extracted event at the
// entry it repeats, and resolveAlreadyListed() only believes it when the two
// actually share a day - a made-up or mistaken ref can't flag an unrelated
// event.
import type { AlreadyListed, ManualEvent, SchoolEvent } from "./types.d.ts";

export type KnownSource = AlreadyListed["source"];

// Either kind of event, with where it's from.
export type KnownInput = { event: SchoolEvent | ManualEvent; source: KnownSource };

const SOURCE_LABELS: Record<KnownSource, string> = {
  whole_school: "Whole School",
  class: "this class",
  year_group: "whole year group",
};

// The last day an event touches - a repeating one's "repeat until".
function lastDay(event: SchoolEvent | ManualEvent) {
  const recurrence = "recurrence" in event ? event.recurrence : null;
  return (recurrence && recurrence.until) || event.end_date || event.date;
}

// The upcoming events (last day today or later) as `refs` ("e1", "e2"...) for
// matching back, and `text`, one line each, for the prompt.
export function knownEventList(inputs: KnownInput[], today: string) {
  const refs = new Map<string, AlreadyListed & { last_day: string }>();
  const lines: string[] = [];
  for (const { event, source } of inputs) {
    const last = lastDay(event);
    if (last < today) continue;
    const ref = `e${refs.size + 1}`;
    const repeats = "recurrence" in event && event.recurrence ? `, repeats until ${last}` : "";
    const span = event.end_date && event.end_date !== event.date ? `${event.date} to ${event.end_date}` : event.date;
    refs.set(ref, {
      title: event.title,
      date: event.date,
      end_date: event.end_date || event.date,
      time: event.time,
      end_time: event.end_time,
      source,
      last_day: last,
    });
    lines.push(`${ref} | ${span}${repeats} | ${event.title} | ${SOURCE_LABELS[source]}`);
  }
  return { refs, text: lines.join("\n") };
}

// The known event an extracted one repeats, or null - when the model gave no
// ref, an unknown one, or one whose dates don't overlap the extracted event's.
export function resolveAlreadyListed(
  extracted: { date: string; end_date: string | null },
  ref: unknown,
  refs: ReturnType<typeof knownEventList>["refs"]
): AlreadyListed | null {
  if (typeof ref !== "string") return null;
  const known = refs.get(ref.trim());
  if (!known) return null;
  const extractedEnd = extracted.end_date || extracted.date;
  if (extracted.date > known.last_day || extractedEnd < known.date) return null;
  const { last_day: _lastDay, ...listed } = known;
  return listed;
}
