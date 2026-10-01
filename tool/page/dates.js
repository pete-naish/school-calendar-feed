// Today's date (YYYY-MM-DD) in London, where the school is - not the
// browser's own timezone.
export function todayIso() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
export function shiftIsoDate(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
// Written out by hand rather than with toLocaleDateString: browsers abbreviate
// September as "Sept" in en-GB, where the weekly list's text (built by the
// server) says "Sep".
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The one way the tool writes a date: "Thu 8 Oct", with the year only when it
// isn't this year's ("Thu 7 Jan 2027") - the same style as the weekly list.
// `weekday: false` drops the day name, for a range of whole weeks ("28 Sep").
export function formatDate(iso, { weekday = true } = {}) {
    const d = new Date(`${iso}T00:00:00Z`);
    const year = iso.slice(0, 4) === todayIso().slice(0, 4) ? "" : ` ${iso.slice(0, 4)}`;
    return `${weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ""}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}
// "October 2026", for the event list's month headings.
export function formatMonthYear(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
// "Thursday"
export function formatWeekday(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
}
// "Thu", for a card's date tile.
export function formatShortWeekday(iso) {
    return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}
// The number of days from one date to another, counting both: 2-4 Nov is 3.
export function daysInclusive(start, end) {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}
// "Tue 27 Oct – Sat 31 Oct", "Wed 7 Oct, 14:30–15:30".
export function formatSchoolSpan({ date = "", end_date, time, end_time }) {
    if (time)
        return `${formatDate(date)}, ${time}${end_time ? `–${end_time}` : ""}`;
    if (end_date && end_date !== date)
        return `${formatDate(date)} – ${formatDate(end_date)}`;
    return formatDate(date);
}
// "This week" / "Next week" / "Last week" for a week starting on `monday`,
// relative to the week (Monday-Sunday) today is in, in London.
export function relativeWeek(monday) {
    const today = todayIso();
    const thisMonday = shiftIsoDate(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    const weeks = Math.round((Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${thisMonday}T00:00:00Z`)) / (7 * 86400000));
    return { [-1]: "Last week", 0: "This week", 1: "Next week" }[weeks] ?? "";
}
export const DEFAULT_MINUTES = 60;
// "09:00" + 60 -> "10:00". Null when that runs past midnight - it can't be
// written as a same-day time - so the field stays empty and the build works
// the end out itself.
export function addMinutes(time, minutes) {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + minutes;
    if (total >= 24 * 60)
        return null;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
// A timed event's length in minutes: start to end, or the default hour when
// it has no end time (the build publishes it that way, scripts/build_ics.py).
export function eventMinutes(start, end) {
    if (!start || !end)
        return DEFAULT_MINUTES;
    const toMinutes = (t) => t.split(":").map(Number).reduce((h, m) => h * 60 + m);
    return toMinutes(end) > toMinutes(start) ? toMinutes(end) - toMinutes(start) : DEFAULT_MINUTES;
}
// A same-day end time at or before its start (validate.ts refuses it too). On
// a multi-day event the end time is on the last day, so anything goes.
export function endsBeforeStart(start, end) {
    return Boolean(start && end && end <= start);
}
