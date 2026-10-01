// Who's signed in, to which calendar, and the class list - plus the API call
// every part of the page makes, and the shapes of events as cards hold them.
import type { ApiResult } from "../appHelpers.js";
import type { ClassEntry, EventException, EventFields, Recurrence, SchoolEvent, YearGroup } from "../functions/api/_shared/types.d.ts";

// An event on a card: a blank one, one the server extracted, or a saved one.
export type DraftEvent = Omit<EventFields, "exceptions"> & { exceptions?: EventException[] };

// A repeat as the card holds it: "repeat until" may still be empty.
export type CardRecurrence = Omit<Recurrence, "until"> & { until: string | null };

// What a card's fields say, sent as the event to save.
export type CardValue = Omit<EventFields, "recurrence"> & { recurrence: CardRecurrence | null; year_group: boolean };

// A school event as listed - flagged when it's in a class's list.
export type ListedSchoolEvent = SchoolEvent & { school_event?: true; year_group?: boolean };

export const FOSPS = { code: "fosps", label: "FOSPS" };
// Restricted entry - description/location editing only, see calendars.ts's
// WHOLE_SCHOOL and isWholeSchoolCalendar() on the server side.
export const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };

// The page's state. Kept in one object (rather than module-level variables)
// because another module can change a field of an imported object but can't
// assign to an imported variable.
export const state: {
  calendar: string | null;
  passcode: string | null;
  // Monday (YYYY-MM-DD) of the week showing in the weekly list.
  weekStart: string | null;
  // "Last Day of ... Term" dates from events-list, for suggestRepeatUntil().
  termEnds: string[];
  // The year groups and their classes: fetched from GET /api/calendars at
  // start-up (see loadCalendars()), which serves docs/classes.js - the single
  // source of truth for class codes and labels. Empty until then.
  yearGroups: YearGroup[];
  allCalendars: (ClassEntry & { yearLabel: string })[];
  // The pasted text events were last extracted from (trimmed), and whether an
  // extraction is running - see updateExtractButtonState().
  lastExtractedText: string;
  extracting: boolean;
  // The event the last delete removed, for its Undo - cleared by switching
  // calendar or by undoing it.
  lastDeleted: CardValue | null;
} = {
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

export function setYearGroups(groups: YearGroup[]) {
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
export function sortedClasses(group: YearGroup) {
  return [...group.classes].sort((a, b) => a.label.localeCompare(b.label));
}

// The year group the signed-in calendar belongs to ({label, classes}), or
// undefined for FOSPS / Whole School. Events for "all of Year 1" are shared
// by every class in the year (see functions/api/_shared/calendars.ts's
// yearGroupFor()).
export function currentYearGroup() {
  return state.yearGroups.find((g) => g.classes.some((c) => c.code === state.calendar));
}

export function yearGroupDescription(group: YearGroup) {
  return `all of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`;
}

export function calendarLabelFor(code: string) {
  if (code === WHOLE_SCHOOL.code) return WHOLE_SCHOOL.label;
  const entry = state.allCalendars.find((c) => c.code === code);
  return entry ? `${entry.yearLabel} — ${entry.label}` : code;
}

export async function apiCall<T>(path: string, payload: unknown): Promise<ApiResult<T>> {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    // fall through with data = null
  }
  return { ok: resp.ok, status: resp.status, data } as ApiResult<T>;
}
