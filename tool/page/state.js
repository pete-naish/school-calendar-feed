export const FOSPS = { code: "fosps", label: "FOSPS" };
// Restricted entry - description/location editing only, see calendars.ts's
// WHOLE_SCHOOL and isWholeSchoolCalendar() on the server side.
export const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };
// The page's state. Kept in one object (rather than module-level variables)
// because another module can change a field of an imported object but can't
// assign to an imported variable.
export const state = {
    calendar: null,
    passcode: null,
    weekStart: null,
    termEnds: [],
    yearGroups: [],
    allCalendars: [],
    lastExtractedText: "",
    extracting: false,
    lastDeleted: null,
};
export function setYearGroups(groups) {
    state.yearGroups = groups;
    state.allCalendars = [
        { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
        { ...FOSPS, yearLabel: "Friends of St Paul's" },
        ...groups.flatMap((g) => g.classes.map((c) => ({ ...c, yearLabel: g.label }))),
    ];
}
// A year group's classes alphabetised by label, for listing them to reps -
// the same order as the public site's calendar list (displayOrder() in
// docs/assets/calendar.ts). state.yearGroups itself stays in config order.
export function sortedClasses(group) {
    return [...group.classes].sort((a, b) => a.label.localeCompare(b.label));
}
// The year group the signed-in calendar belongs to ({label, classes}), or
// undefined for FOSPS / Whole School. Events for "all of Year 1" are shared
// by every class in the year (see functions/api/_shared/calendars.ts's
// yearGroupFor()).
export function currentYearGroup() {
    return state.yearGroups.find((g) => g.classes.some((c) => c.code === state.calendar));
}
export function yearGroupDescription(group) {
    return `all of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`;
}
export function calendarLabelFor(code) {
    if (code === WHOLE_SCHOOL.code)
        return WHOLE_SCHOOL.label;
    const entry = state.allCalendars.find((c) => c.code === code);
    return entry ? `${entry.yearLabel} — ${entry.label}` : code;
}
export async function apiCall(path, payload) {
    const resp = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
    });
    let data = null;
    try {
        data = await resp.json();
    }
    catch {
        // fall through with data = null
    }
    return { ok: resp.ok, status: resp.status, data };
}
// Browser storage (sessionStorage or localStorage) that can be missing or
// throw - a private window, blocked site data - in which case nothing is
// remembered and everything still works.
export function storageGet(storage, key) {
    try {
        return storage.getItem(key);
    }
    catch {
        return null;
    }
}
export function storageSet(storage, key, value) {
    try {
        if (value === null)
            storage.removeItem(key);
        else
            storage.setItem(key, value);
    }
    catch {
        // not available - nothing to remember
    }
}
