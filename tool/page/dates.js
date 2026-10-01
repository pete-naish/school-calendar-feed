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
// "Thu, 9 Oct 2026"
export function formatDayDate(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
// "9 Oct 2026"
export function formatEventDate(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
// "Thursday"
export function formatWeekday(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
}
// "Tue 27 Oct 2026 – Sat 31 Oct 2026", "Wed 7 Oct 2026, 14:30–15:30".
export function formatSchoolSpan({ date = "", end_date, time, end_time }) {
    if (time)
        return `${formatDayDate(date)}, ${time}${end_time ? `–${end_time}` : ""}`;
    if (end_date && end_date !== date)
        return `${formatDayDate(date)} – ${formatDayDate(end_date)}`;
    return formatDayDate(date);
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
