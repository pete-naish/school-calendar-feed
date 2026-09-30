// Reading the site's own already-published .ics files (the same public-URL
// approach termEnd.ts and wholeSchool.ts use), for callers that need more of
// an event than wholeSchool.ts's id/title/date/description/location - the
// weekly list needs times, end dates and recurrence.
//
// Deliberately not a general iCalendar parser: it reads only what
// scripts/build_ics.py writes. In particular a recurrence is always
// FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL and UNTIL (no BYDAY/COUNT), with
// every skipped occurrence listed in an EXDATE, and a moved occurrence is a
// separate one-off event - so weekList.ts can expand a week of occurrences
// with plain date arithmetic.
//
// Dates are handled as integer day numbers (whole days since 1970-01-01, UTC
// arithmetic) holding the *Europe/London calendar date*: a TZID=Europe/London
// value already is one, and a `...Z` instant is converted, so nothing
// downstream needs to think about time zones or DST.

import type { RecurrenceFreq } from "./types.d.ts";

export interface DayAndTime {
  day: number;
  time: string;
}

export interface Rrule {
  freq: RecurrenceFreq;
  interval: number;
  untilDay: number | null;
}

export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  startDay: number;
  startTime: string | null;
  endDay: number;
  endTime: string | null;
  rrule: Rrule | null;
  exdays: Set<number>;
}

export const CALENDARS_URL = "https://pete-naish.github.io/school-calendar-feed/calendars";

const MS_PER_DAY = 86400000;

export function unescapeIcsText(text: string) {
  return text.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// No cf.cacheTtl (unlike termEnd.ts's 1hr cache) - a rep loading a page here
// wants genuinely current events, not a stale edge-cached copy.
export async function fetchIcsText(icsFile: string): Promise<string> {
  const resp = await fetch(`${CALENDARS_URL}/${icsFile}`);
  if (!resp.ok) throw new Error(`Fetch ${icsFile} failed: ${resp.status}`);
  return resp.text();
}

export function isoToDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function dayToIso(day: number) {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

// 0 = Monday ... 6 = Sunday.
export function weekdayIndex(day: number) {
  return (new Date(day * MS_PER_DAY).getUTCDay() + 6) % 7;
}

export function dayParts(day: number) {
  const d = new Date(day * MS_PER_DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// The London calendar date and clock time of a UTC instant.
export function londonDayAndTime(date: Date): DayAndTime {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of LONDON_PARTS.formatToParts(date)) parts[type] = value;
  return {
    day: isoToDay(`${parts.year}-${parts.month}-${parts.day}`),
    time: `${parts.hour}:${parts.minute}`,
  };
}

// One DTSTART/DTEND/EXDATE value -> { day, time }, `time` being "HH:MM", or
// null for an all-day (date-only) value.
export function parseDateTime(value: string): { day: number; time: string | null } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, utc] = m;
  if (hh === undefined) return { day: isoToDay(`${y}-${mo}-${d}`), time: null };
  if (utc) return londonDayAndTime(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm)));
  return { day: isoToDay(`${y}-${mo}-${d}`), time: `${hh}:${mm}` };
}

function parseRrule(value: string): Rrule {
  const fields = Object.fromEntries(value.split(";").map((part) => part.split("=")));
  return {
    freq: fields.FREQ as RecurrenceFreq,
    interval: Math.max(1, parseInt(fields.INTERVAL, 10) || 1),
    // UNTIL is a date (all-day series) or a `...T235959Z` instant (timed) -
    // either way the series' last day is its first 8 digits.
    untilDay: fields.UNTIL ? isoToDay(fields.UNTIL.replace(/^(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3")) : null,
  };
}

// Every VEVENT as { uid, title, description, location, startDay, startTime,
// endDay (inclusive), endTime, rrule, exdays }. `startTime`/`endTime` are
// "HH:MM", or null for an all-day event (`endTime` also when there's no DTEND); `rrule` is { freq, interval, untilDay } or null; `exdays`
// is a Set of the start days a recurring event skips. VTIMEZONE blocks are
// ignored (they sit outside any VEVENT).
export function parseIcsEvents(icsText: string): IcsEvent[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const events: IcsEvent[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const props: Record<string, string> = {};
    const exdates: string[] = [];
    for (const line of block.split("END:VEVENT")[0].split(/\r?\n/)) {
      const m = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/);
      if (!m) continue;
      if (m[1] === "EXDATE") exdates.push(...m[2].split(","));
      else props[m[1]] = m[2];
    }

    const start = props.DTSTART && parseDateTime(props.DTSTART);
    if (!props.UID || !start) continue;

    // An all-day DTEND is exclusive (the day after the last one); a timed
    // one's date is the last day.
    let endDay = start.day;
    const end = props.DTEND && parseDateTime(props.DTEND);
    if (end) endDay = end.time === null ? end.day - 1 : end.day;

    events.push({
      uid: props.UID.trim(),
      title: unescapeIcsText((props.SUMMARY || "").trim()),
      description: unescapeIcsText((props.DESCRIPTION || "").trim()),
      location: unescapeIcsText((props.LOCATION || "").trim()),
      startDay: start.day,
      startTime: start.time,
      endDay: Math.max(endDay, start.day),
      endTime: end && start.time !== null ? end.time : null,
      rrule: props.RRULE ? parseRrule(props.RRULE) : null,
      exdays: new Set(exdates.flatMap((v) => parseDateTime(v.trim())?.day ?? [])),
    });
  }
  return events;
}
