// Choosing a calendar and signing in to it, staying signed in across a
// refresh, and switching to another calendar.
import { cardState } from "./cardState.js";
import { confirmSecondClick, el, resetConfirm } from "./dom.js";
import { updateDraftControlsVisibility, updateExtractButtonState } from "./drafts.js";
import { allEventCards, renderExistingEvents, renderWholeSchoolEvents } from "./eventList.js";
import { apiCall, calendarLabelFor, FOSPS, setYearGroups, sortedClasses, state, WHOLE_SCHOOL } from "./state.js";
import type { CalendarsResponse, ClassListedEvent, ListResponse, SchoolEvent } from "../functions/api/_shared/types.d.ts";

// Fills the calendar picker once the class list has arrived. Until then the
// picker only holds its "Choose a calendar…" placeholder, so login stays
// disabled; if the list can't be fetched, say so rather than show an empty picker.
export async function loadCalendars() {
  let data: CalendarsResponse | null = null;
  try {
    const resp = await fetch("/api/calendars");
    if (resp.ok) data = await resp.json();
  } catch {
    // fall through with data = null
  }
  if (!data || !Array.isArray(data.yearGroups)) {
    el.loginError.textContent = "Couldn't load the list of calendars. Check your connection and refresh the page.";
    el.loginError.hidden = false;
    return;
  }
  setYearGroups(data.yearGroups);
  fillCalendarPicker();
}

// Class calendars first - nearly everyone here is a class rep - then FOSPS and
// the restricted Whole School entry.
function fillCalendarPicker() {
  for (const group of state.yearGroups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const cls of sortedClasses(group)) {
      const opt = document.createElement("option");
      opt.value = cls.code;
      opt.textContent = cls.label;
      optgroup.appendChild(opt);
    }
    el.calendarSelect.appendChild(optgroup);
  }

  const other = document.createElement("optgroup");
  other.label = "Other";
  for (const entry of [FOSPS, WHOLE_SCHOOL]) other.appendChild(new Option(entry.label, entry.code));
  el.calendarSelect.appendChild(other);

  const last = storageGet(localStorage, LAST_CALENDAR_KEY);
  if (last && state.allCalendars.some((c) => c.code === last)) el.calendarSelect.value = last;
}

// --- Staying signed in ----------------------------------------------------------
//
// The calendar and passcode are kept for the tab (sessionStorage), so a
// refresh doesn't mean looking the passcode up again; closing the tab or
// "Switch calendar" forgets them. The last calendar picked is remembered
// (localStorage, no passcode) to preselect it next time. The passcode box also
// lets a password manager save it, with the calendar as its username. Storage
// can be missing or throw (private windows, blocked site data), which just
// means none of this happens.

const SESSION_KEY = "rep-tool-session";
const LAST_CALENDAR_KEY = "rep-tool-last-calendar";

function storageGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // not available - nothing to remember
  }
}

// Signs straight back in after a refresh, if this tab was signed in.
export function restoreSession() {
  let saved: { calendar?: unknown; passcode?: unknown } | null = null;
  try {
    saved = JSON.parse(storageGet(sessionStorage, SESSION_KEY) || "null");
  } catch {
    // a garbled entry is the same as none
  }
  if (!saved || typeof saved.calendar !== "string" || typeof saved.passcode !== "string") return;
  if (!state.allCalendars.some((c) => c.code === saved.calendar)) return;
  el.calendarSelect.value = saved.calendar;
  el.passcodeInput.value = saved.passcode;
  updateLoginButtonState();
  handleLogin();
}

export function updateLoginButtonState() {
  el.loginButton.disabled = !(el.calendarSelect.value && el.passcodeInput.value);
}

export async function handleLogin() {
  const calendar = el.calendarSelect.value;
  const passcode = el.passcodeInput.value;
  el.loginError.hidden = true;
  el.loginButton.disabled = true;
  el.loginButton.textContent = "Checking…";

  const { ok, status, data } = await apiCall<ListResponse>("/api/events-list", { calendar, passcode });

  el.loginButton.textContent = "Continue";
  if (!ok) {
    el.loginButton.disabled = false;
    storageSet(sessionStorage, SESSION_KEY, null);
    if (status === 401) {
      el.loginError.textContent = "Wrong passcode for this calendar.";
    } else {
      // e.g. 429 rate_limited (see _shared/auth.ts) - data.message is written
      // for a rep to read; data.error is just a machine-readable code.
      el.loginError.textContent = (data && data.message) || "Something went wrong - try again.";
    }
    el.loginError.hidden = false;
    return;
  }

  state.calendar = calendar;
  state.passcode = passcode;
  state.termEnds = Array.isArray(data.term_ends) ? data.term_ends : [];
  storageSet(sessionStorage, SESSION_KEY, JSON.stringify({ calendar, passcode }));
  storageSet(localStorage, LAST_CALENDAR_KEY, calendar);
  el.usernameInput.value = calendarLabelFor(calendar);
  el.activeCalendarName.textContent = calendarLabelFor(calendar);
  el.loginSection.hidden = true;
  el.appSection.hidden = false;

  const isWholeSchool = calendar === WHOLE_SCHOOL.code;
  el.addSection.hidden = isWholeSchool;
  el.wholeSchoolNotice.hidden = !isWholeSchool;

  // Which list comes back depends on the calendar (see ListResponse).
  if (isWholeSchool) {
    renderWholeSchoolEvents(data.events as SchoolEvent[]);
  } else {
    renderExistingEvents(data.events as ClassListedEvent[]);
  }
}

// What switching calendar or leaving the page would lose: pasted text not yet
// extracted, new events not yet saved, or a saved event with unsaved edits
// (see setDirty()).
export function hasUnsavedWork() {
  const text = el.pasteTextarea.value.trim();
  return (
    (text !== "" && text !== state.lastExtractedText) ||
    el.draftCards.children.length > 0 ||
    allEventCards().some((card) => cardState(card).dirty)
  );
}

// With unsaved work on the page, the first click says it'll be lost.
export function handleSwitchCalendar() {
  if (hasUnsavedWork() && !confirmSecondClick(el.switchCalendarButton, "Unsaved changes will be lost - click again to switch")) return;
  resetConfirm(el.switchCalendarButton);
  storageSet(sessionStorage, SESSION_KEY, null);
  state.calendar = null;
  state.passcode = null;
  state.termEnds = [];
  el.passcodeInput.value = "";
  el.usernameInput.value = "";
  el.pasteTextarea.value = "";
  state.lastExtractedText = "";
  updateExtractButtonState();
  el.draftCards.innerHTML = "";
  el.existingCards.innerHTML = "";
  el.pastCards.innerHTML = "";
  el.pastEvents.open = false;
  el.pastEvents.hidden = true;
  el.saveSuccess.hidden = true;
  el.weekListPanel.hidden = true;
  el.weekListError.hidden = true;
  el.weekListOutput.value = "";
  el.weekListButton.hidden = false;
  state.weekStart = null;
  el.eventSearch.value = "";
  el.eventKind.value = "";
  el.existingStatus.hidden = true;
  state.lastDeleted = null;
  el.appSection.hidden = true;
  el.addSection.hidden = false;
  el.wholeSchoolNotice.hidden = true;
  el.loginSection.hidden = false;
  updateDraftControlsVisibility();
  updateLoginButtonState();
}
