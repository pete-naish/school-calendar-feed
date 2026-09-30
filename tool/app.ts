import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic, isPastEvent } from "./appHelpers.js";
import type { ApiResult, Dated } from "./appHelpers.js";
import type {
  ApiError,
  CalendarsResponse,
  ClassEntry,
  ClassListedEvent,
  DeleteResponse,
  EventException,
  EventFields,
  ListResponse,
  ParseResponse,
  Recurrence,
  RecurrenceFreq,
  SaveResponse,
  SchoolEvent,
  SpanFields,
  UpdateResponse,
  WeekResponse,
  YearGroup,
} from "./functions/api/_shared/types.ts";

// The element `selector` finds inside `root`. The page's templates always
// have it, so a miss is a bug - which throws on first use, as it always has.
function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector(selector) as T;
}

// Anything with a .value.
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// An event on a card: a blank one, one the server extracted, or a saved one.
type DraftEvent = Omit<EventFields, "exceptions"> & { exceptions?: EventException[] };

// A repeat as the card holds it: "repeat until" may still be empty.
type CardRecurrence = Omit<Recurrence, "until"> & { until: string | null };

// What a card's fields say, sent as the event to save.
type CardValue = Omit<EventFields, "recurrence"> & { recurrence: CardRecurrence | null; year_group: boolean };

// A school event as listed - flagged when it's in a class's list.
type ListedSchoolEvent = SchoolEvent & { school_event?: true; year_group?: boolean };

// The year groups and their classes: fetched from GET /api/calendars at
// start-up (see loadCalendars()), which serves docs/classes.js - the single
// source of truth for class codes and labels. Empty until then.
let YEAR_GROUPS: YearGroup[] = [];
let ALL_CALENDARS: (ClassEntry & { yearLabel: string })[] = [];
const FOSPS = { code: "fosps", label: "FOSPS" };
// Restricted entry - description/location editing only, see calendars.js's
// WHOLE_SCHOOL and isWholeSchoolCalendar() on the server side.
const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };

const RECURRENCE_OPTIONS: Record<string, { freq: RecurrenceFreq; interval: number }> = {
  daily: { freq: "DAILY", interval: 1 },
  weekly: { freq: "WEEKLY", interval: 1 },
  fortnightly: { freq: "WEEKLY", interval: 2 },
  monthly: { freq: "MONTHLY", interval: 1 },
};

function recurrenceToSelectValue(recurrence: CardRecurrence | Recurrence | null | undefined) {
  if (!recurrence) return "";
  if (recurrence.freq === "DAILY") return "daily";
  if (recurrence.freq === "WEEKLY" && recurrence.interval === 2) return "fortnightly";
  if (recurrence.freq === "WEEKLY") return "weekly";
  if (recurrence.freq === "MONTHLY") return "monthly";
  return ""; // an interval/freq combination the picker can't represent - treated as non-recurring here
}

// A year group's classes alphabetised by label, for listing them to reps -
// the same order as the public site's calendar list (displayOrder() in
// docs/assets/calendar.js). YEAR_GROUPS itself stays in config order.
function sortedClasses(group: YearGroup) {
  return [...group.classes].sort((a, b) => a.label.localeCompare(b.label));
}

function setYearGroups(groups: YearGroup[]) {
  YEAR_GROUPS = groups;
  ALL_CALENDARS = [
    { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
    { ...FOSPS, yearLabel: "Friends of St Paul's" },
    ...YEAR_GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, yearLabel: g.label }))),
  ];
}

const state: { calendar: string | null; passcode: string | null; weekStart: string | null } = {
  calendar: null,
  passcode: null,
  weekStart: null, // Monday (YYYY-MM-DD) of the week showing in the weekly list
};

// The page's own elements - always there, since index.html and this ship together.
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const el = {
  calendarSelect: byId<HTMLSelectElement>("calendar-select"),
  passcodeInput: byId<HTMLInputElement>("passcode-input"),
  loginButton: byId<HTMLButtonElement>("login-button"),
  loginError: byId("login-error"),
  loginSection: byId("login-section"),
  appSection: byId("app-section"),
  activeCalendarName: byId("active-calendar-name"),
  switchCalendarButton: byId<HTMLButtonElement>("switch-calendar-button"),
  wholeSchoolNotice: byId("whole-school-notice"),
  addSection: byId("add-section"),
  wholeSchoolCardTemplate: byId<HTMLTemplateElement>("whole-school-event-template"),
  pasteTextarea: byId<HTMLTextAreaElement>("paste-textarea"),
  extractButton: byId<HTMLButtonElement>("extract-button"),
  extractError: byId("extract-error"),
  extractLoading: byId("extract-loading"),
  draftCards: byId("draft-cards"),
  addManualCardButton: byId<HTMLButtonElement>("add-manual-card-button"),
  saveAllButton: byId<HTMLButtonElement>("save-all-button"),
  saveError: byId("save-error"),
  saveSuccess: byId("save-success"),
  existingLoading: byId("existing-loading"),
  existingEmpty: byId("existing-empty"),
  existingCards: byId("existing-cards"),
  pastEvents: byId<HTMLDetailsElement>("past-events"),
  pastCount: byId("past-count"),
  pastCards: byId("past-cards"),
  schoolEventsNotice: byId("school-events-notice"),
  cardTemplate: byId<HTMLTemplateElement>("event-card-template"),
  weekListButton: byId<HTMLButtonElement>("week-list-button"),
  weekListError: byId("week-list-error"),
  weekListPanel: byId("week-list-panel"),
  weekListLabel: byId("week-list-label"),
  weekListOutput: byId<HTMLTextAreaElement>("week-list-output"),
  weekPrevButton: byId<HTMLButtonElement>("week-prev-button"),
  weekNextButton: byId<HTMLButtonElement>("week-next-button"),
  weekCopyButton: byId<HTMLButtonElement>("week-copy-button"),
};

// Fills the calendar picker once the class list has arrived. Until then the
// picker only holds its "Choose a calendar…" placeholder, so login stays
// disabled; if the list can't be fetched, say so rather than show an empty picker.
async function loadCalendars() {
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

function fillCalendarPicker() {
  const wholeSchoolOpt = document.createElement("option");
  wholeSchoolOpt.value = WHOLE_SCHOOL.code;
  wholeSchoolOpt.textContent = WHOLE_SCHOOL.label;
  el.calendarSelect.appendChild(wholeSchoolOpt);

  const fospsOpt = document.createElement("option");
  fospsOpt.value = FOSPS.code;
  fospsOpt.textContent = FOSPS.label;
  el.calendarSelect.appendChild(fospsOpt);

  for (const group of YEAR_GROUPS) {
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
}

function init() {
  loadCalendars();
  el.calendarSelect.addEventListener("change", updateLoginButtonState);
  el.passcodeInput.addEventListener("input", updateLoginButtonState);
  el.passcodeInput.addEventListener("keydown", (e) => {
    // Same guard as the button: no calendar picked yet (or a login already
    // in flight) leaves it disabled, and Enter must respect that too.
    if (e.key === "Enter" && !el.loginButton.disabled) handleLogin();
  });
  el.loginButton.addEventListener("click", handleLogin);
  el.switchCalendarButton.addEventListener("click", handleSwitchCalendar);
  el.extractButton.addEventListener("click", handleExtract);
  el.addManualCardButton.addEventListener("click", () => addDraftCard(blankEvent()));
  el.saveAllButton.addEventListener("click", handleSaveAll);
  el.weekListButton.addEventListener("click", () => handleWeekList());
  el.weekPrevButton.addEventListener("click", () => handleWeekList(-7));
  el.weekNextButton.addEventListener("click", () => handleWeekList(7));
  el.weekCopyButton.addEventListener("click", handleCopyWeekList);
}

// The year group the signed-in calendar belongs to ({label, classes}), or
// undefined for FOSPS / Whole School. Events for "all of Year 1" are shared
// by every class in the year (see functions/api/_shared/calendars.js's
// yearGroupFor()).
function currentYearGroup() {
  return YEAR_GROUPS.find((g) => g.classes.some((c) => c.code === state.calendar));
}

function yearGroupDescription(group: YearGroup) {
  return `all of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`;
}

// A new event on a class calendar can be ticked as "all of Year 1", saving it
// once for every class in the year. An already-saved event can't switch
// scope here: a shared one shows a note instead of the tick box (editing or
// deleting it changes it for the whole year), and a class-only one shows
// neither.
function setupYearGroupControls(card: HTMLElement, { saved = false, shared = false } = {}) {
  const group = currentYearGroup();
  const toggle = find(card, ".field-year-group-label");
  const note = find(card, ".year-group-note");
  toggle.hidden = true;
  note.hidden = true;
  if (!group) return;
  if (shared) {
    note.textContent = `Shared with ${yearGroupDescription(group)} - editing or deleting it changes it for every class (an exception can be limited to one class, though).`;
    note.hidden = false;
  } else if (!saved) {
    find(card, ".field-year-group-text").textContent = `Add to ${yearGroupDescription(group)}`;
    toggle.hidden = false;
  }
}

function blankEvent(): DraftEvent {
  return { title: "", date: "", end_date: null, time: null, end_time: null, description: null, location: null, url: null, recurrence: null };
}

function localValidationError(value: CardValue) {
  if (!value.title || !value.date) return "Title and date are required.";
  if (value.end_date && value.end_date < value.date) return "End date can't be before the start date.";
  if (value.recurrence && !value.recurrence.until) return "Repeat until date is required for a repeating event.";
  return null;
}

function updateLoginButtonState() {
  el.loginButton.disabled = !(el.calendarSelect.value && el.passcodeInput.value);
}

function calendarLabelFor(code: string) {
  if (code === WHOLE_SCHOOL.code) return WHOLE_SCHOOL.label;
  const entry = ALL_CALENDARS.find((c) => c.code === code);
  return entry ? `${entry.yearLabel} — ${entry.label}` : code;
}

async function apiCall<T>(path: string, payload: unknown): Promise<ApiResult<T>> {
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

async function handleLogin() {
  const calendar = el.calendarSelect.value;
  const passcode = el.passcodeInput.value;
  el.loginError.hidden = true;
  el.loginButton.disabled = true;
  el.loginButton.textContent = "Checking…";

  const { ok, status, data } = await apiCall<ListResponse>("/api/events-list", { calendar, passcode });

  el.loginButton.textContent = "Continue";
  if (!ok) {
    el.loginButton.disabled = false;
    if (status === 401) {
      el.loginError.textContent = "Wrong passcode for this calendar.";
    } else {
      // e.g. 429 rate_limited (see _shared/auth.js) - data.message is written
      // for a rep to read; data.error is just a machine-readable code.
      el.loginError.textContent = (data && data.message) || "Something went wrong - try again.";
    }
    el.loginError.hidden = false;
    return;
  }

  state.calendar = calendar;
  state.passcode = passcode;
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

function handleSwitchCalendar() {
  state.calendar = null;
  state.passcode = null;
  el.passcodeInput.value = "";
  el.pasteTextarea.value = "";
  el.draftCards.innerHTML = "";
  el.existingCards.innerHTML = "";
  el.pastCards.innerHTML = "";
  el.pastEvents.open = false;
  el.pastEvents.hidden = true;
  el.saveSuccess.hidden = true;
  el.weekListPanel.hidden = true;
  el.weekListError.hidden = true;
  el.weekListOutput.value = "";
  state.weekStart = null;
  el.appSection.hidden = true;
  el.addSection.hidden = false;
  el.wholeSchoolNotice.hidden = true;
  el.loginSection.hidden = false;
  updateDraftControlsVisibility();
  updateLoginButtonState();
}

async function handleExtract() {
  const text = el.pasteTextarea.value;
  if (!text.trim()) return;

  el.extractError.hidden = true;
  el.extractLoading.hidden = false;
  el.extractButton.disabled = true;

  const { ok, data } = await apiCall<ParseResponse>("/api/parse", { calendar: state.calendar, passcode: state.passcode, text });

  el.extractLoading.hidden = true;
  el.extractButton.disabled = false;

  if (!ok) {
    el.extractError.textContent = (data && data.message) || "Couldn't extract events - try again, or add the event manually below.";
    el.extractError.hidden = false;
    return;
  }

  if (!data.events || data.events.length === 0) {
    el.extractError.textContent = "No events found in that text - try pasting more detail, or add one manually below.";
    el.extractError.hidden = false;
  }

  for (const event of data.events || []) {
    addDraftCard(event);
  }
}

const DEFAULT_MINUTES = 60;

// "09:00" + 60 -> "10:00". Null when that runs past midnight - it can't be
// written as a same-day time - so the field stays empty and the build works
// the end out itself.
function addMinutes(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// A timed event's length in minutes: start to end, or the default hour when
// it has no end time (the build publishes it that way, scripts/build_ics.py).
function eventMinutes(start: string | null, end: string | null) {
  if (!start || !end) return DEFAULT_MINUTES;
  const toMinutes = (t: string) => t.split(":").map(Number).reduce((h, m) => h * 60 + m);
  return toMinutes(end) > toMinutes(start) ? toMinutes(end) - toMinutes(start) : DEFAULT_MINUTES;
}

// Fills `endInput` `minutes()` after `startInput` now, and keeps it there as
// the start changes - until the rep sets a different end time, which is left
// alone. `skip()` says when there's no such default to show (a multi-day
// event with no end time runs to the end of its last day instead).
function wireDefaultEndTime(
  startInput: HTMLInputElement,
  endInput: HTMLInputElement,
  { minutes = (): number => DEFAULT_MINUTES, skip = (): boolean => false } = {}
) {
  let lastStart = "";
  let lastMinutes = minutes();
  const sync = () => {
    const start = startInput.value;
    const untouched = !endInput.value || endInput.value === (lastStart && addMinutes(lastStart, lastMinutes));
    lastStart = start;
    lastMinutes = minutes();
    if (untouched) endInput.value = (start && !skip() && addMinutes(start, lastMinutes)) || "";
  };
  startInput.addEventListener("input", sync);
  sync();
}

function wireCardDefaultEndTime(card: HTMLElement) {
  const date = find<HTMLInputElement>(card, ".field-date");
  const endDate = find<HTMLInputElement>(card, ".field-end-date");
  wireDefaultEndTime(find<HTMLInputElement>(card, ".field-time"), find<HTMLInputElement>(card, ".field-end-time"), {
    skip: () => Boolean(endDate.value && endDate.value !== date.value),
  });
}

function fillCardFields(card: HTMLElement, event: DraftEvent) {
  find<Field>(card, ".field-title").value = event.title || "";
  find<Field>(card, ".field-date").value = event.date || "";
  find<Field>(card, ".field-end-date").value = event.end_date || "";
  find<Field>(card, ".field-time").value = event.time || "";
  find<Field>(card, ".field-end-time").value = event.end_time || "";
  find<Field>(card, ".field-description").value = event.description || "";
  find<Field>(card, ".field-location").value = event.location || "";
  find<Field>(card, ".field-url").value = event.url || "";
  find<Field>(card, ".field-recurrence").value = recurrenceToSelectValue(event.recurrence);
  find<Field>(card, ".field-recurrence-until").value = (event.recurrence && event.recurrence.until) || "";
}

function readCardFields(card: HTMLElement): CardValue {
  const recurSelectValue = find<Field>(card, ".field-recurrence").value;
  const recurUntil = find<Field>(card, ".field-recurrence-until").value || null;
  const recurrence = recurSelectValue ? { ...RECURRENCE_OPTIONS[recurSelectValue], until: recurUntil } : null;
  return {
    title: find<Field>(card, ".field-title").value.trim(),
    date: find<Field>(card, ".field-date").value,
    end_date: find<Field>(card, ".field-end-date").value || null,
    time: find<Field>(card, ".field-time").value || null,
    end_time: find<Field>(card, ".field-end-time").value || null,
    description: find<Field>(card, ".field-description").value.trim() || null,
    location: find<Field>(card, ".field-location").value.trim() || null,
    url: find<Field>(card, ".field-url").value.trim() || null,
    year_group: find<HTMLInputElement>(card, ".field-year-group").checked,
    recurrence,
    exceptions: getCardExceptions(card),
  };
}

// Exceptions (single-occurrence move/cancel) are only offered on an
// already-saved recurring event (renderExistingEvents), never on a draft
// card - there's no series to override yet. The working list lives as
// JSON in a data attribute on the card, so it flows through the normal
// "Save changes" -> /api/events-update path with no separate endpoint.
function getCardExceptions(card: HTMLElement): EventException[] {
  try {
    return JSON.parse(card.dataset.exceptions || "[]");
  } catch {
    return [];
  }
}

function setCardExceptions(card: HTMLElement, exceptions: EventException[]) {
  card.dataset.exceptions = JSON.stringify(exceptions);
  renderExceptionsList(card);
}

// " (RR only)" for an exception scoped to some of the year's classes; nothing
// for one that applies to every class (or on a class's own, unshared event).
function exceptionScopeText(exc: EventException) {
  const group = currentYearGroup();
  if (!group || !exc.classes || exc.classes.length === 0) return "";
  const labels = exc.classes
    .map((code) => group.classes.find((c) => c.code === code)?.label || code.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
  return ` (${labels.join(" and ")} only)`;
}

function formatExceptionSummary(exc: EventException) {
  const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const scope = exceptionScopeText(exc);
  if (exc.action === "cancelled") return `${fmt(exc.date)}: cancelled${scope}`;
  const timeText = exc.new_time ? ` at ${exc.new_time}${exc.new_end_time ? `–${exc.new_end_time}` : ""}` : "";
  return `${fmt(exc.date)}: moved to ${fmt(exc.new_date)}${timeText}${scope}`;
}

// Whether two same-date exceptions would clash: both unscoped (every class),
// or both scoped with a class in common. An unscoped one alongside a
// class-specific one is deliberate and fine - the build lets the specific one
// win (e.g. PE moved for the whole year, but cancelled for RR's class trip).
function exceptionScopesClash(a: EventException, b: EventException) {
  const aScoped = (a.classes?.length ?? 0) > 0;
  const bScoped = (b.classes?.length ?? 0) > 0;
  if (!aScoped && !bScoped) return true;
  if (aScoped && bScoped) return a.classes!.some((code) => b.classes!.includes(code));
  return false;
}

function renderExceptionsList(card: HTMLElement) {
  const container = find(card, ".exceptions-list");
  container.innerHTML = "";
  getCardExceptions(card).forEach((exc, index) => {
    const row = document.createElement("div");
    row.className = "exception-row";
    const text = document.createElement("span");
    text.textContent = formatExceptionSummary(exc);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "exception-remove-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      setCardExceptions(card, getCardExceptions(card).filter((_, i) => i !== index));
    });
    row.append(text, removeButton);
    container.appendChild(row);
  });
}

// `shared` is true for an event shared by the whole year group: its
// exceptions can then be limited to one class (e.g. only RR's class trip
// clashes with the shared PE) via an "Applies to" choice.
function wireExceptionsSection(card: HTMLElement, initialExceptions: EventException[] | undefined, { shared = false } = {}) {
  card.dataset.exceptions = JSON.stringify(initialExceptions || []);
  renderExceptionsList(card);

  const section = find(card, ".field-exceptions");
  const recurrenceSelect = find<HTMLSelectElement>(card, ".field-recurrence");
  const syncSectionVisibility = () => {
    section.hidden = !recurrenceSelect.value;
  };
  recurrenceSelect.addEventListener("change", syncSectionVisibility);
  syncSectionVisibility();

  const actionSelect = find<HTMLSelectElement>(card, ".exception-action");
  const moveFields = find(card, ".exception-move-fields");
  const syncMoveFieldsVisibility = () => {
    moveFields.hidden = actionSelect.value !== "moved";
  };
  actionSelect.addEventListener("change", syncMoveFieldsVisibility);
  syncMoveFieldsVisibility();

  const scopeRow = find(card, ".exception-scope-row");
  const scopeSelect = find<HTMLSelectElement>(card, ".exception-scope");
  const group = currentYearGroup();
  if (shared && group) {
    scopeSelect.innerHTML = "";
    scopeSelect.add(new Option(`All of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`, ""));
    for (const cls of sortedClasses(group)) scopeSelect.add(new Option(`${cls.label} only`, cls.code));
    scopeRow.hidden = false;
  }

  const dateInput = find<HTMLInputElement>(card, ".exception-date");
  const newDateInput = find<HTMLInputElement>(card, ".exception-new-date");
  const newTimeInput = find<HTMLInputElement>(card, ".exception-new-time");
  const newEndTimeInput = find<HTMLInputElement>(card, ".exception-new-end-time");
  // A moved occurrence keeps the event's own length, so a new start with no
  // new end doesn't quietly shorten (or lengthen) it.
  wireDefaultEndTime(newTimeInput, newEndTimeInput, {
    minutes: () => eventMinutes(find<Field>(card, ".field-time").value, find<Field>(card, ".field-end-time").value),
  });

  find(card, ".exception-add-button").addEventListener("click", () => {
    if (!dateInput.value) return;
    const errorEl = find(card, ".field-error");
    errorEl.hidden = true;
    // Built up field by field; the select only offers "cancelled" and "moved".
    const exception = { date: dateInput.value, action: actionSelect.value } as EventException & {
      new_date?: string;
      new_time?: string | null;
      new_end_time?: string | null;
    };
    if (!scopeRow.hidden && scopeSelect.value) exception.classes = [scopeSelect.value];
    if (exception.action === "moved") {
      if (!newDateInput.value) return;
      exception.new_date = newDateInput.value;
      exception.new_time = newTimeInput.value || null;
      exception.new_end_time = newEndTimeInput.value || null;
    }
    const clash = getCardExceptions(card).find((e) => e.date === exception.date && exceptionScopesClash(e, exception));
    if (clash) {
      errorEl.textContent = `There's already an exception on that date${exceptionScopeText(clash)} - remove it first to change it.`;
      errorEl.hidden = false;
      return;
    }
    setCardExceptions(card, [...getCardExceptions(card), exception]);
    dateInput.value = "";
    newDateInput.value = "";
    newTimeInput.value = "";
    newEndTimeInput.value = "";
  });
}

// Shows the "Repeat until" field only once a repeat frequency is picked.
function wireRecurrenceToggle(card: HTMLElement) {
  const select = find<HTMLSelectElement>(card, ".field-recurrence");
  const untilLabel = find(card, ".field-recurrence-until-label");
  const sync = () => {
    untilLabel.hidden = !select.value;
  };
  select.addEventListener("change", sync);
  sync();
}

function updateDraftControlsVisibility() {
  el.saveAllButton.hidden = el.draftCards.children.length === 0;
}

function addDraftCard(event: DraftEvent) {
  const node = el.cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  fillCardFields(node, event);
  wireCardDefaultEndTime(node);
  wireRecurrenceToggle(node);
  setupYearGroupControls(node);
  find<HTMLButtonElement>(node, ".card-save-button").hidden = true; // drafts save via "Save all", not individually
  find<HTMLButtonElement>(node, ".card-remove-button").addEventListener("click", () => {
    node.remove();
    updateDraftControlsVisibility();
  });
  el.draftCards.appendChild(node);
  updateDraftControlsVisibility();
}

async function handleSaveAll() {
  const cards = [...el.draftCards.querySelectorAll<HTMLElement>(".event-card")];
  if (cards.length === 0) return;

  el.saveError.hidden = true;
  let hasFieldError = false;
  const events = cards.map((card) => {
    const errorEl = find(card, ".field-error");
    const value = readCardFields(card);
    const error = localValidationError(value);
    if (error) {
      errorEl.textContent = error;
      errorEl.hidden = false;
      hasFieldError = true;
    } else {
      errorEl.hidden = true;
    }
    return value;
  });
  if (hasFieldError) return;

  el.saveAllButton.disabled = true;
  el.saveAllButton.textContent = "Saving…";

  const resp = await apiCall<SaveResponse>("/api/save", {
    calendar: state.calendar,
    passcode: state.passcode,
    events,
    ...confirmPublicField(el.saveAllButton),
  });
  const { ok, data } = resp;

  el.saveAllButton.disabled = false;
  disarmPublicConfirm(el.saveAllButton);
  el.saveAllButton.textContent = "Save all";

  if (isConfirmPublic(resp)) {
    armPublicConfirm(el.saveAllButton, "Save all", el.saveError, resp.data.message, el.draftCards);
    return;
  }
  if (!ok) {
    el.saveError.textContent = (data && data.message) || "Couldn't save - try again.";
    el.saveError.hidden = false;
    return;
  }

  const skipped = data.skipped_duplicates ? ` (${data.skipped_duplicates} duplicate skipped)` : "";
  const wait = data.rebuild_triggered ? "within a few minutes" : "within 6 hours";
  el.saveSuccess.textContent = `${data.saved} event(s) saved${skipped}. They'll appear in the calendar ${wait}.`;
  el.saveSuccess.hidden = false;
  el.draftCards.innerHTML = "";
  el.pasteTextarea.value = "";
  updateDraftControlsVisibility();

  const listResult = await apiCall<ListResponse>("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (listResult.ok) renderExistingEvents(listResult.data.events as ClassListedEvent[]);
}

// The "What's on this week" WhatsApp list. No argument: this week (or next,
// on a Sunday - the server decides). `shiftDays` (-7/+7) steps from the week
// already showing.
async function handleWeekList(shiftDays?: number) {
  el.weekListError.hidden = true;
  const buttons = [el.weekListButton, el.weekPrevButton, el.weekNextButton];
  buttons.forEach((b) => (b.disabled = true));

  const body: { calendar: string | null; passcode: string | null; week_start?: string } = {
    calendar: state.calendar,
    passcode: state.passcode,
  };
  if (shiftDays && state.weekStart) body.week_start = shiftIsoDate(state.weekStart, shiftDays);
  const { ok, data } = await apiCall<WeekResponse>("/api/week", body);

  buttons.forEach((b) => (b.disabled = false));
  if (!ok) {
    el.weekListError.textContent = (data && (data.message || data.error)) || "Couldn't build the list - try again.";
    el.weekListError.hidden = false;
    return;
  }
  state.weekStart = data.week_start;
  el.weekListLabel.textContent = `${formatEventDate(data.week_start)} – ${formatEventDate(data.week_end)}`;
  el.weekListOutput.value = data.text;
  el.weekListPanel.hidden = false;
}

function shiftIsoDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function handleCopyWeekList() {
  const text = el.weekListOutput.value;
  const originalText = el.weekCopyButton.textContent;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Clipboard API unavailable or blocked (e.g. plain http) - fall back to
    // selecting the text and the legacy copy command.
    el.weekListOutput.select();
    copied = document.execCommand("copy");
  }
  el.weekCopyButton.textContent = copied ? "Copied ✓" : "Press Ctrl/Cmd+C to copy";
  setTimeout(() => {
    el.weekCopyButton.textContent = originalText;
  }, 2000);
}

function formatEventDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Today's date (YYYY-MM-DD) in London, where the school is - not the
// browser's own timezone.
function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

// Upcoming events in date order, then past ones newest first in the folded
// "Past events" section, so the list a rep lands on doesn't fill up with
// last term's events.
function renderEventLists<E extends Dated>(events: E[], makeCard: (event: E) => HTMLElement) {
  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.pastCards.innerHTML = "";
  const today = todayIso();
  const past = [];
  for (const event of events) {
    if (isPastEvent(event, today)) past.push(event);
    else el.existingCards.appendChild(makeCard(event));
  }
  for (const event of past.reverse()) el.pastCards.appendChild(makeCard(event));
  updateEventListState();
}

function updateEventListState() {
  const pastTotal = el.pastCards.children.length;
  el.existingEmpty.hidden = el.existingCards.children.length > 0;
  el.pastCount.textContent = String(pastTotal);
  el.pastEvents.hidden = pastTotal === 0;
}

// The date, plus the start (and end) time when the event has one.
function formatEventWhen(event: { date: string; time: string | null; end_time: string | null }) {
  const date = formatEventDate(event.date);
  if (!event.time) return date;
  return `${date}, ${event.time}${event.end_time ? `–${event.end_time}` : ""}`;
}

// Whole School events aren't stored/edited like a normal manual event -
// title/date/recurrence/etc all come from the school's own feed and can't
// be changed here, so this renders a much simpler read-mostly card (see
// #whole-school-event-template) instead of the full event-card-template
// used everywhere else, with only description + location fields and one
// save button.
function renderWholeSchoolEvents(events: SchoolEvent[]) {
  el.schoolEventsNotice.hidden = true;
  renderEventLists(events, createSchoolEventCard);
}

// The same card also stands in for a school-sourced event in a class's own
// list (event.school_event), where it's flagged as coming from the school's
// calendar - and, if the sibling class has it too, as shared with the year.
function createSchoolEventCard(event: ListedSchoolEvent): HTMLElement {
  const node = el.wholeSchoolCardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  find(node, ".ws-title").textContent = event.title;
  find(node, ".ws-date").textContent = formatSchoolSpan(event);
  find<Field>(node, ".field-description").value = event.description || "";
  find<Field>(node, ".field-location").value = event.location || "";

  if (event.school_event) {
    find(node, ".ws-flag").hidden = false;
    const group = currentYearGroup();
    if (event.year_group && group) {
      find(node, ".ws-shared-note").textContent = `Shared with ${yearGroupDescription(group)} - changes apply to every class.`;
    }
  }

  // What the server last had, to send back only the fields a rep actually
  // changed - saving a location alone must not also store the school's
  // current description as an override (which would then stop following
  // the school's own edits to it).
  const saved = { description: (event.description || "").trim(), location: event.location || "" };
  const saveButton = find<HTMLButtonElement>(node, ".card-save-button");
  saveButton.addEventListener("click", () => handleUpdateWholeSchoolEvent(node, event.id, saveButton, saved));
  setupDateCorrection(node, event);
  return node;
}

// --- Correcting a school event's date/time -----------------------------------
//
// For when the school's own calendar is wrong. It changes the event for every
// family subscribed to it, and for a closure day which days recurring class
// events skip, so it's kept out of the way (a closed <details>), explains what
// it does, needs a reason, and takes two clicks: the first spells out the
// change, the second makes it. See functions/api/_shared/schoolEventCorrections.js.

// Same keywords as _CLOSURE_KEYWORDS in scripts/build_ics.py.
const CLOSURE_KEYWORDS = /\bINSET\b|\bHALF TERM\b|\bHOLIDAY\b/i;

function formatDayDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// "Tue 27 Oct 2026 – Sat 31 Oct 2026", "Wed 7 Oct 2026, 14:30–15:30".
function formatSchoolSpan({ date = "", end_date, time, end_time }: SpanFields) {
  if (time) return `${formatDayDate(date)}, ${time}${end_time ? `–${end_time}` : ""}`;
  if (end_date && end_date !== date) return `${formatDayDate(date)} – ${formatDayDate(end_date)}`;
  return formatDayDate(date);
}

// Who a correction reaches, for the warning and the confirmation.
function correctionAudience(event: ListedSchoolEvent) {
  if (state.calendar === WHOLE_SCHOOL.code) return "every family subscribed to the Whole School calendar";
  const group = currentYearGroup();
  if (event.year_group && group) return `every family subscribed to ${yearGroupDescription(group)}`;
  return `every family subscribed to ${calendarLabelFor(state.calendar!)}`;
}

// The corrected {start, end} in the file's format, or an error to show.
function readCorrection(
  card: HTMLElement,
  event: ListedSchoolEvent
): { start: string; end: string; span: SpanFields; error?: undefined } | { error: string } {
  const value = (cls: string) => find<Field>(card, cls).value;
  if (!event.time) {
    const start = value(".correction-start-date");
    const end = value(".correction-end-date") || start;
    if (!start) return { error: "Choose the first day." };
    if (end < start) return { error: "The last day can't be before the first day." };
    return { start, end, span: { date: start, end_date: end } };
  }
  const date = value(".correction-date");
  const time = value(".correction-time");
  const endTime = value(".correction-end-time");
  if (!date || !time || !endTime) return { error: "Choose the date, start time and end time." };
  if (endTime <= time) return { error: "The end time must be after the start time." };
  return { start: `${date}T${time}`, end: `${date}T${endTime}`, span: { date, end_date: date, time, end_time: endTime } };
}

function setupDateCorrection(card: HTMLElement, event: ListedSchoolEvent) {
  const section = find(card, ".date-correction");
  // Past events don't matter any more, and a timed event running over several
  // days has no same-day end time to correct (the server refuses both too).
  if (isPastEvent(event, todayIso()) || (event.time && !event.end_time)) return;
  section.hidden = false;

  const school = event.correction ? event.correction.school : event;
  if (event.correction) {
    find(card, ".ws-corrected").hidden = false;
    const was = school ? `School's calendar says ${formatSchoolSpan(school)}.` : "";
    const why = event.correction.note ? ` Reason: ${event.correction.note}` : "";
    find(card, ".ws-corrected-text").textContent = `${was}${why}`.trim();
  }
  find(card, ".correction-audience").textContent = correctionAudience(event);
  find(card, ".correction-closure").hidden = !CLOSURE_KEYWORDS.test(event.title);
  find(card, ".correction-school").textContent = school
    ? `School's calendar says: ${formatSchoolSpan(school)}`
    : "";

  if (event.time) {
    find(card, ".correction-timed").hidden = false;
    find<Field>(card, ".correction-date").value = event.date;
    find<Field>(card, ".correction-time").value = event.time;
    find<Field>(card, ".correction-end-time").value = event.end_time ?? "";
    wireDefaultEndTime(find<HTMLInputElement>(card, ".correction-time"), find<HTMLInputElement>(card, ".correction-end-time"), {
      minutes: () => eventMinutes(event.time, event.end_time),
    });
  } else {
    find(card, ".correction-all-day").hidden = false;
    find<Field>(card, ".correction-start-date").value = event.date;
    find<Field>(card, ".correction-end-date").value = event.end_date || event.date;
  }
  const min = todayIso();
  for (const input of section.querySelectorAll<HTMLInputElement>('input[type="date"]')) input.min = min;

  const saveButton = find<HTMLButtonElement>(card, ".correction-save-button");
  const undoButton = find<HTMLButtonElement>(card, ".correction-undo-button");
  undoButton.hidden = !event.correction;
  // Any change after the first click takes the confirmation back - it no
  // longer describes what would be saved.
  section.addEventListener("input", () => disarmCorrection(card));

  saveButton.addEventListener("click", () => {
    const errorEl = find(card, ".correction-error");
    errorEl.hidden = true;
    const read = readCorrection(card, event);
    const note = find<Field>(card, ".correction-note").value.replace(/\s+/g, " ").trim();
    if (read.error !== undefined || note.length < 5) {
      errorEl.textContent = read.error ?? 'Say how you know the right date or time (e.g. "Newsletter 25 Sep").';
      errorEl.hidden = false;
      return;
    }
    if (formatSchoolSpan(read.span) === formatSchoolSpan(event)) {
      errorEl.textContent = "That's the date it already has.";
      errorEl.hidden = false;
      return;
    }
    const message = `Change "${event.title}" from ${formatSchoolSpan(event)} to ${formatSchoolSpan(read.span)} for ${correctionAudience(event)}?`;
    submitCorrection(card, event, saveButton, message, "Yes, change it for everyone", { start: read.start, end: read.end, note });
  });
  undoButton.addEventListener("click", () => {
    const back = school ? ` (${formatSchoolSpan(school)})` : "";
    const message = `Put "${event.title}" back to the school's own date${back} for ${correctionAudience(event)}?`;
    submitCorrection(card, event, undoButton, message, "Yes, go back to the school's date", null);
  });
}

function disarmCorrection(card: HTMLElement) {
  find(card, ".correction-confirm").hidden = true;
  for (const button of card.querySelectorAll<HTMLButtonElement>(".correction-save-button, .correction-undo-button")) {
    if (button.dataset.label) button.textContent = button.dataset.label;
    delete button.dataset.label;
    delete button.dataset.armed;
  }
}

// First click: say exactly what will change and arm the button. Second click
// on the same (still armed) button: save.
async function submitCorrection(
  card: HTMLElement,
  event: ListedSchoolEvent,
  button: HTMLButtonElement,
  message: string,
  armedLabel: string,
  correction: { start: string; end: string; note: string } | null
) {
  const confirmEl = find(card, ".correction-confirm");
  const errorEl = find(card, ".correction-error");
  if (button.dataset.armed !== "1") {
    disarmCorrection(card);
    confirmEl.textContent = message;
    confirmEl.hidden = false;
    button.dataset.label = button.textContent;
    button.dataset.armed = "1";
    button.textContent = armedLabel;
    return;
  }

  const label = button.dataset.label;
  button.disabled = true;
  button.textContent = "Saving…";
  const { ok, data } = await apiCall<UpdateResponse>("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id: event.id,
    ...(state.calendar !== WHOLE_SCHOOL.code && { school_event: true }),
    date_correction: correction,
  });
  button.disabled = false;
  disarmCorrection(card);
  if (!ok) {
    errorEl.textContent = (data && data.message) || "Couldn't save that - try again.";
    errorEl.hidden = false;
    button.textContent = label ?? null;
    return;
  }

  // Show the event as it now stands. Where the school's own dates aren't
  // known (a correction made by hand, then undone), the list is reloaded.
  const school: SpanFields | null = event.correction
    ? event.correction.school
    : { date: event.date, end_date: event.end_date, time: event.time, end_time: event.end_time };
  if (!school) {
    await reloadEventList();
    return;
  }
  const { correction: _old, ...base } = event;
  let updated: ListedSchoolEvent = { ...base, ...school };
  if (correction) {
    const [date, time] = correction.start.split("T");
    const [endDate, endTime] = correction.end.split("T");
    const span = { date, end_date: endDate, time: time || null, end_time: endTime || null };
    const same = (["date", "end_date", "time", "end_time"] as const).every((k) => (span[k] || null) === (school[k] || null));
    updated = same ? updated : { ...updated, ...span, correction: { note: correction.note, school } };
  }
  const fresh = createSchoolEventCard(updated);
  const status = find(fresh, ".correction-confirm");
  status.textContent = "Saved ✓ - the calendars update in a few minutes, and people's calendar apps pick it up on their next refresh.";
  status.hidden = false;
  find<HTMLDetailsElement>(fresh, ".date-correction").open = true;
  card.replaceWith(fresh);
}

async function reloadEventList() {
  const { ok, data } = await apiCall<ListResponse>("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (!ok) return;
  if (state.calendar === WHOLE_SCHOOL.code) renderWholeSchoolEvents(data.events as SchoolEvent[]);
  else renderExistingEvents(data.events as ClassListedEvent[]);
}

async function handleUpdateWholeSchoolEvent(
  card: HTMLElement,
  id: string,
  button: HTMLButtonElement,
  saved: { description: string; location: string }
) {
  const errorEl = find(card, ".field-error");
  errorEl.hidden = true;
  const description = find<Field>(card, ".field-description").value.trim();
  const location = find<Field>(card, ".field-location").value.replace(/\s+/g, " ").trim();

  const changes: { description?: string; location?: string } = {};
  if (description !== saved.description) changes.description = description;
  if (location !== saved.location) changes.location = location;

  const originalText = button.dataset.label || button.textContent;
  if (Object.keys(changes).length === 0) {
    button.textContent = "No changes";
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
    return;
  }

  button.disabled = true;
  button.textContent = "Saving…";

  const resp = await apiCall<UpdateResponse>("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id,
    ...(state.calendar !== WHOLE_SCHOOL.code && { school_event: true }),
    ...changes,
    ...confirmPublicField(button),
  });
  const { ok, data } = resp;

  button.disabled = false;
  if (isConfirmPublic(resp)) {
    armPublicConfirm(button, originalText, errorEl, resp.data.message, card);
    return;
  }
  disarmPublicConfirm(button);
  if (!ok) {
    errorEl.textContent = (data && data.message) || "Couldn't save changes - try again.";
    errorEl.hidden = false;
    button.textContent = originalText;
    return;
  }
  Object.assign(saved, changes);
  button.textContent = "Saved ✓";
  setTimeout(() => {
    button.textContent = originalText;
  }, 2000);
}

function renderExistingEvents(events: ClassListedEvent[]) {
  el.schoolEventsNotice.hidden = !events.some((e) => e.school_event);
  renderEventLists(events, (event) => (event.school_event ? createSchoolEventCard(event) : createExistingEventCard(event)));
}

function createExistingEventCard(event: ClassListedEvent & { school_event?: undefined }) {
  const node = el.cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  fillCardFields(node, event);
  wireCardDefaultEndTime(node);
  wireRecurrenceToggle(node);
  wireExceptionsSection(node, event.exceptions, { shared: Boolean(event.year_group) });
  setupYearGroupControls(node, { saved: true, shared: Boolean(event.year_group) });

  const saveButton = find<HTMLButtonElement>(node, ".card-save-button");
  saveButton.hidden = false;
  saveButton.addEventListener("click", () => handleUpdateExisting(node, event.id, saveButton));

  const removeButton = find<HTMLButtonElement>(node, ".card-remove-button");
  removeButton.textContent = "Delete";
  removeButton.addEventListener("click", () => handleDeleteExisting(node, event.id, removeButton));

  return node;
}

async function handleUpdateExisting(card: HTMLElement, id: string, button: HTMLButtonElement) {
  const errorEl = find(card, ".field-error");
  const value = readCardFields(card);
  const error = localValidationError(value);
  if (error) {
    errorEl.textContent = error;
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  button.disabled = true;
  const originalText = button.dataset.label || button.textContent;
  button.textContent = "Saving…";

  const resp = await apiCall<UpdateResponse>("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id,
    event: value,
    ...confirmPublicField(button),
  });
  const { ok, data } = resp;

  button.disabled = false;
  if (isConfirmPublic(resp)) {
    armPublicConfirm(button, originalText, errorEl, resp.data.message, card);
    return;
  }
  disarmPublicConfirm(button);
  if (!ok) {
    errorEl.textContent = (data && data.message) || "Couldn't save changes - try again.";
    errorEl.hidden = false;
    button.textContent = originalText;
    return;
  }
  button.textContent = "Saved ✓";
  setTimeout(() => {
    button.textContent = originalText;
  }, 2000);
}

async function handleDeleteExisting(card: HTMLElement, id: string, button: HTMLButtonElement) {
  if (!button.classList.contains("confirm")) {
    button.classList.add("confirm");
    button.textContent = "Really delete?";
    setTimeout(() => {
      button.classList.remove("confirm");
      button.textContent = "Delete";
    }, 4000);
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting…";
  const { ok, data } = await apiCall<DeleteResponse>("/api/events-delete", { calendar: state.calendar, passcode: state.passcode, id });

  if (!ok) {
    const errorEl = find(card, ".field-error");
    errorEl.textContent = (data && data.message) || "Couldn't delete - try again.";
    errorEl.hidden = false;
    button.disabled = false;
    button.classList.remove("confirm");
    button.textContent = "Delete";
    return;
  }

  card.remove();
  updateEventListState();
}

init();
