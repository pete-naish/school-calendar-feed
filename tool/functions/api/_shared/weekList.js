// Builds the "What's on this week" list class reps paste into their class
// WhatsApp group each Sunday, from the site's published .ics files (see
// ics.js): the calendar's own events plus whole-school ones, for one
// Monday-Sunday week. Reading the published feeds means closure days,
// cancelled/moved occurrences and description/location edits are already
// applied, exactly as parents' calendar apps see them.

import { parseIcsEvents, isoToDay, dayToIso, weekdayIndex, dayParts, londonDayAndTime } from "./ics.js";

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
// show up literally in WhatsApp. One entry per non-blank line.
export function descriptionLines(text) {
  return text
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function collectItems(icsText, weekStartDay, { titlePrefix = "", wholeSchool = false } = {}) {
  const items = [];
  for (const event of parseIcsEvents(icsText)) {
    const title = titlePrefix && event.title.startsWith(titlePrefix) ? event.title.slice(titlePrefix.length) : event.title;
    for (const { startDay, endDay } of occurrencesInWeek(event, weekStartDay)) {
      items.push({
        title,
        startDay,
        endDay,
        startTime: event.startTime,
        description: descriptionLines(event.description),
        location: event.location,
        wholeSchool,
      });
    }
  }
  return items;
}

// `calendarIcs` is the logged-in calendar's own .ics text (null for Whole
// School, whose events are all in `wholeSchoolIcs`). Returns the WhatsApp
// text (*bold* day headings, • bullets) and how many events it lists.
export function buildWeekText({ calendarIcs, wholeSchoolIcs, calendar, weekStart }) {
  const weekStartDay = isoToDay(weekStart);
  const items = [
    ...(calendarIcs ? collectItems(calendarIcs, weekStartDay, { titlePrefix: `${calendar.toUpperCase()}: ` }) : []),
    ...collectItems(wholeSchoolIcs, weekStartDay, { wholeSchool: true }),
  ];

  // A multi-day event that began before the week is listed under Monday.
  const byDay = new Map();
  for (const item of items) {
    const day = Math.max(item.startDay, weekStartDay);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(item);
  }

  const lines = [`*What's on this week (${weekLabel(weekStartDay)})*`];
  if (items.length === 0) lines.push("", "Nothing scheduled this week.");

  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    lines.push("", `*${shortDate(day)}*`);
    const dayItems = byDay.get(day).sort(
      (a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title)
    );
    for (const item of dayItems) {
      const time = item.startTime ? `${formatTime(item.startTime)} ` : "";
      const range = item.endDay > item.startDay ? ` (${shortDate(item.startDay)} – ${shortDate(item.endDay)})` : "";
      const source = item.wholeSchool && calendar !== "whole-school" ? " — Whole School" : "";
      lines.push(`• ${time}${item.title}${range}${source}`);
      if (item.location) lines.push(`  Location: ${item.location}`);
      for (const line of item.description) lines.push(`  ${line}`);
    }
  }
  return { text: lines.join("\n"), count: items.length };
}

export function weekEnd(weekStart) {
  return dayToIso(isoToDay(weekStart) + 6);
}
