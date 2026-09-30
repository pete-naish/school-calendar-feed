// Builds the "What's on this week" list class reps paste into their class
// WhatsApp group each Sunday, from the site's published .ics files (see
// ics.js): the calendar's own events plus whole-school ones (and, for a
// class, FOSPS ones), for one Monday-Sunday week, then a "Future dates"
// heads-up for the week after. Reading the published feeds means closure
// days, cancelled/moved occurrences and description/location edits are
// already applied, exactly as parents' calendar apps see them.

import { parseIcsEvents, isoToDay, dayToIso, weekdayIndex, dayParts, londonDayAndTime } from "./ics.js";
import { titlePrefixFor } from "./calendars.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(day, { withMonth = true } = {}) {
  const { date, month } = dayParts(day);
  return `${WEEKDAYS[weekdayIndex(day)]} ${date}${withMonth ? ` ${MONTHS[month - 1]}` : ""}`;
}

function weekLabel(weekStartDay) {
  const end = weekStartDay + 6;
  const sameMonth = dayParts(weekStartDay).month === dayParts(end).month;
  return `${shortDate(weekStartDay, { withMonth: !sameMonth })} – ${shortDate(end)}`;
}

// "19:30" -> "7:30pm", "09:00" -> "9am".
function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

// "14:30", "15:05" -> "2:30–3:05pm"; "11:00", "13:00" -> "11am–1pm". No
// end (or one equal to the start) gives just the start time.
function formatTimeRange(start, end) {
  if (!end || end === start) return formatTime(start);
  const from = formatTime(start);
  const to = formatTime(end);
  const sameHalf = from.slice(-2) === to.slice(-2);
  return `${sameHalf ? from.slice(0, -2) : from}–${to}`;
}

export function snapToMonday(iso) {
  const day = isoToDay(iso);
  return dayToIso(day - weekdayIndex(day));
}

// The week a rep most likely wants: the Monday of this week - or, on a
// Sunday (when the list is sent out), the Monday after.
export function defaultWeekStart(now = new Date()) {
  const today = londonDayAndTime(now).day;
  const dow = weekdayIndex(today);
  return dayToIso(dow === 6 ? today + 1 : today - dow);
}

function monthsBetween(fromDay, toDay) {
  const a = dayParts(fromDay);
  const b = dayParts(toDay);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

// Whether a recurring event has an occurrence *starting* on `day`.
function occursOn(event, day) {
  const { freq, interval, untilDay } = event.rrule;
  if (day < event.startDay || (untilDay !== null && day > untilDay) || event.exdays.has(day)) return false;
  const elapsed = day - event.startDay;
  if (freq === "DAILY") return elapsed % interval === 0;
  if (freq === "WEEKLY") return elapsed % (7 * interval) === 0;
  if (freq === "MONTHLY") {
    return dayParts(day).date === dayParts(event.startDay).date && monthsBetween(event.startDay, day) % interval === 0;
  }
  return false;
}

// Each occurrence of `event` that overlaps the week, as { startDay, endDay }.
// A multi-day occurrence that began before the week still counts (its start
// is looked for from a duration earlier).
function occurrencesInWeek(event, weekStartDay) {
  const weekEndDay = weekStartDay + 6;
  const duration = event.endDay - event.startDay;
  if (!event.rrule) {
    return event.startDay <= weekEndDay && event.endDay >= weekStartDay ? [{ startDay: event.startDay, endDay: event.endDay }] : [];
  }
  const found = [];
  for (let day = weekStartDay - duration; day <= weekEndDay; day++) {
    if (occursOn(event, day)) found.push({ startDay: day, endDay: day + duration });
  }
  return found;
}

// School descriptions come through with raw HTML (<p>, <br />) that would
// show up literally in WhatsApp. One entry per line, keeping a single blank
// line ("") wherever the description had one or more between paragraphs,
// but none at the start or end.
export function descriptionLines(text) {
  return text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, lines) => line || (lines[i - 1] && lines.slice(i + 1).some(Boolean)));
}

function collectItems(icsText, weekStartDay, { titlePrefix = "" } = {}) {
  const items = [];
  for (const event of parseIcsEvents(icsText)) {
    const title = titlePrefix && event.title.startsWith(titlePrefix) ? event.title.slice(titlePrefix.length) : event.title;
    for (const { startDay, endDay } of occurrencesInWeek(event, weekStartDay)) {
      items.push({
        title,
        startDay,
        endDay,
        startTime: event.startTime,
        // A timed event running past midnight shows its day range instead.
        endTime: endDay === startDay ? event.endTime : null,
        description: descriptionLines(event.description),
        location: event.location,
        recurring: Boolean(event.rrule),
      });
    }
  }
  return items;
}

// `calendarIcs` is the logged-in calendar's own .ics text (null for Whole
// School, whose events are all in `wholeSchoolIcs`). `fospsIcs` is FOSPS's
// .ics text for a class calendar, else null; those events keep their
// "FOSPS: " prefix so parents can tell them apart; whole-school ones aren't
// marked, since which calendar added an event doesn't matter to parents.
// Returns the WhatsApp text (*bold* day headings, • bullets, > quoted
// details) and how many events it lists.
export function buildWeekText({ calendarIcs, wholeSchoolIcs, fospsIcs = null, calendar, weekStart }) {
  const weekStartDay = isoToDay(weekStart);
  const itemsFor = (startDay) => [
    ...(calendarIcs ? collectItems(calendarIcs, startDay, { titlePrefix: titlePrefixFor(calendar) }) : []),
    ...collectItems(wholeSchoolIcs, startDay),
    ...(fospsIcs ? collectItems(fospsIcs, startDay) : []),
  ];
  const items = itemsFor(weekStartDay);

  // A multi-day event that began before the week is listed under Monday.
  const byDay = new Map();
  for (const item of items) {
    const day = Math.max(item.startDay, weekStartDay);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }

  const lines = [`*This week: ${weekLabel(weekStartDay)}*`];
  if (items.length === 0) lines.push("", "Nothing scheduled this week.");

  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    lines.push("", `*${shortDate(day)}*`);
    const dayItems = byDay.get(day).sort(
      (a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title)
    );
    for (const item of dayItems) {
      const time = item.startTime ? `${formatTimeRange(item.startTime, item.endTime)} ` : "";
      const range = item.endDay > item.startDay ? ` (${shortDate(item.startDay)} – ${shortDate(item.endDay)})` : "";
      lines.push(`• ${time}${item.title}${range}`);
      // Details go in a WhatsApp quote block, which sets them apart from the
      // titles and keeps wrapped lines indented. Blank lines between
      // paragraphs are dropped: WhatsApp shows a bare ">" literally.
      const details = [...(item.location ? [`Location: ${item.location}`] : []), ...item.description];
      lines.push(...details.filter(Boolean).map((line) => `> ${line}`));
    }
  }

  // A heads-up for the following week: one line per event, no details, and
  // no recurring events (PE days etc.) since parents already know those.
  // Anything that started this week was listed above.
  const nextWeekStartDay = weekStartDay + 7;
  const future = itemsFor(nextWeekStartDay)
    .filter((item) => !item.recurring && item.startDay >= nextWeekStartDay)
    .sort((a, b) => a.startDay - b.startDay || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title));
  if (future.length) {
    lines.push("", "*Future dates*");
    for (const item of future) {
      const when = item.endDay > item.startDay ? `${shortDate(item.startDay)} – ${shortDate(item.endDay)}` : shortDate(item.startDay);
      const time = item.startTime ? `${formatTimeRange(item.startTime, item.endTime)} ` : "";
      lines.push(`• *${when}* ${time}${item.title}`);
    }
  }
  return { text: lines.join("\n"), count: items.length };
}

export function weekEnd(weekStart) {
  return dayToIso(isoToDay(weekStart) + 6);
}
