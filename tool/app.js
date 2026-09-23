// The year groups and their classes: fetched from GET /api/calendars at
// start-up (see loadCalendars()), which serves docs/classes.js - the single
// source of truth for class codes and labels. Empty until then.
let YEAR_GROUPS = [];
let ALL_CALENDARS = [];
const FOSPS = { code: "fosps", label: "FOSPS" };
// Restricted entry - description/location editing only, see calendars.js's
// WHOLE_SCHOOL and isWholeSchoolCalendar() on the server side.
const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };

const RECURRENCE_OPTIONS = {
  daily: { freq: "DAILY", interval: 1 },
  weekly: { freq: "WEEKLY", interval: 1 },
  fortnightly: { freq: "WEEKLY", interval: 2 },
  monthly: { freq: "MONTHLY", interval: 1 },
};

function recurrenceToSelectValue(recurrence) {
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
function sortedClasses(group) {
  return [...group.classes].sort((a, b) => a.label.localeCompare(b.label));
}

function setYearGroups(groups) {
  YEAR_GROUPS = groups;
  ALL_CALENDARS = [
    { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
  { ...FOSPS, yearLabel: "Friends of St Paul's" },
    ...YEAR_GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, yearLabel: g.label }))),
    { ...FOSPS, yearLabel: "Friends of St Paul's" },
  ];
}

const state = {
  calendar: null,
  passcode: null,
  weekStart: null, // Monday (YYYY-MM-DD) of the week showing in the weekly list
};

const el = {
  calendarSelect: document.getElementById("calendar-select"),
  passcodeInput: document.getElementById("passcode-input"),
  loginButton: document.getElementById("login-button"),
  loginError: document.getElementById("login-error"),
  loginSection: document.getElementById("login-section"),
  appSection: document.getElementById("app-section"),
  activeCalendarName: document.getElementById("active-calendar-name"),
  switchCalendarButton: document.getElementById("switch-calendar-button"),
  wholeSchoolNotice: document.getElementById("whole-school-notice"),
  addSection: document.getElementById("add-section"),
  wholeSchoolCardTemplate: document.getElementById("whole-school-event-template"),
  pasteTextarea: document.getElementById("paste-textarea"),
  extractButton: document.getElementById("extract-button"),
  extractError: document.getElementById("extract-error"),
  extractLoading: document.getElementById("extract-loading"),
  draftCards: document.getElementById("draft-cards"),
  addManualCardButton: document.getElementById("add-manual-card-button"),
  saveAllButton: document.getElementById("save-all-button"),
  saveError: document.getElementById("save-error"),
  saveSuccess: document.getElementById("save-success"),
  existingLoading: document.getElementById("existing-loading"),
  existingEmpty: document.getElementById("existing-empty"),
  existingCards: document.getElementById("existing-cards"),
  schoolEventsNotice: document.getElementById("school-events-notice"),
  cardTemplate: document.getElementById("event-card-template"),
  weekListButton: document.getElementById("week-list-button"),
  weekListError: document.getElementById("week-list-error"),
  weekListPanel: document.getElementById("week-list-panel"),
  weekListLabel: document.getElementById("week-list-label"),
  weekListOutput: document.getElementById("week-list-output"),
  weekPrevButton: document.getElementById("week-prev-button"),
  weekNextButton: document.getElementById("week-next-button"),
  weekCopyButton: document.getElementById("week-copy-button"),
};

// Fills the calendar picker once the class list has arrived. Until then the
// picker only holds its "Choose a calendar…" placeholder, so login stays
// disabled; if the list can't be fetched, say so rather than show an empty picker.
async function loadCalendars() {
  let data = null;
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

function yearGroupDescription(group) {
  return `all of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`;
}

// A new event on a class calendar can be ticked as "all of Year 1", saving it
// once for every class in the year. An already-saved event can't switch
// scope here: a shared one shows a note instead of the tick box (editing or
// deleting it changes it for the whole year), and a class-only one shows
// neither.
function setupYearGroupControls(card, { saved = false, shared = false } = {}) {
  const group = currentYearGroup();
  const toggle = card.querySelector(".field-year-group-label");
  const note = card.querySelector(".year-group-note");
  toggle.hidden = true;
  note.hidden = true;
  if (!group) return;
  if (shared) {
    note.textContent = `Shared with ${yearGroupDescription(group)} - editing or deleting it changes it for every class (an exception can be limited to one class, though).`;
    note.hidden = false;
  } else if (!saved) {
    card.querySelector(".field-year-group-text").textContent = `Add to ${yearGroupDescription(group)}`;
    toggle.hidden = false;
  }
}

function blankEvent() {
  return { title: "", date: "", end_date: null, time: null, end_time: null, description: null, location: null, url: null, recurrence: null };
}

function localValidationError(value) {
  if (!value.title || !value.date) return "Title and date are required.";
  if (value.end_date && value.end_date < value.date) return "End date can't be before the start date.";
  if (value.recurrence && !value.recurrence.until) return "Repeat until date is required for a repeating event.";
  return null;
}

function updateLoginButtonState() {
  el.loginButton.disabled = !(el.calendarSelect.value && el.passcodeInput.value);
}

function calendarLabelFor(code) {
  if (code === WHOLE_SCHOOL.code) return WHOLE_SCHOOL.label;
  const entry = ALL_CALENDARS.find((c) => c.code === code);
  return entry ? `${entry.yearLabel} — ${entry.label}` : code;
}

async function apiCall(path, payload) {
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
  return { ok: resp.ok, status: resp.status, data };
}

// The server answers 409 "confirm_public" when the text looks like it holds
// personal contact details (a mobile number, a personal email...): events are
// public and permanent. Its message says what it found, and the save button
// becomes "Save anyway" - pressing it sends the same save again with
// confirm_public. Any edit inside `watch` takes the confirmation back, since the
// text may now hold something else. `label` is what the button normally says -
// passed in, because by the time the server answers the button says "Saving…".
// See functions/api/_shared/personalDetails.js.
function isConfirmPublic(resp) {
  return resp.status === 409 && Boolean(resp.data) && resp.data.error === "confirm_public";
}

function armPublicConfirm(button, label, errorEl, message, watch) {
  button.dataset.label = label;
  button.dataset.confirmPublic = "1";
  button.textContent = "Save anyway";
  errorEl.textContent = message;
  errorEl.hidden = false;
  watch.addEventListener(
    "input",
    () => {
      disarmPublicConfirm(button);
      errorEl.hidden = true;
    },
    { once: true }
  );
}

function disarmPublicConfirm(button) {
  if (button.dataset.label) button.textContent = button.dataset.label;
  delete button.dataset.label;
  delete button.dataset.confirmPublic;
}

// Spread into a save request's body: confirms it if the button is armed.
function confirmPublicField(button) {
  return button.dataset.confirmPublic === "1" ? { confirm_public: true } : {};
}

async function handleLogin() {
  const calendar = el.calendarSelect.value;
  const passcode = el.passcodeInput.value;
  el.loginError.hidden = true;
  el.loginButton.disabled = true;
  el.loginButton.textContent = "Checking…";

  const { ok, status, data } = await apiCall("/api/events-list", { calendar, passcode });

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

  if (isWholeSchool) {
    renderWholeSchoolEvents(data.events);
  } else {
    renderExistingEvents(data.events);
  }
}

function handleSwitchCalendar() {
  state.calendar = null;
  state.passcode = null;
  el.passcodeInput.value = "";
  el.pasteTextarea.value = "";
  el.draftCards.innerHTML = "";
  el.existingCards.innerHTML = "";
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

  const { ok, data } = await apiCall("/api/parse", { calendar: state.calendar, passcode: state.passcode, text });

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
  el.pasteTextarea.value = "";
}

const DEFAULT_MINUTES = 60;

// "09:00" + 60 -> "10:00". Null when that runs past midnight - it can't be
// written as a same-day time - so the field stays empty and the build works
// the end out itself.
function addMinutes(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// A timed event's length in minutes: start to end, or the default hour when
// it has no end time (the build publishes it that way, scripts/build_ics.py).
function eventMinutes(start, end) {
  if (!start || !end) return DEFAULT_MINUTES;
  const toMinutes = (t) => t.split(":").reduce((h, m) => h * 60 + Number(m));
  return toMinutes(end) > toMinutes(start) ? toMinutes(end) - toMinutes(start) : DEFAULT_MINUTES;
}

// Fills `endInput` `minutes()` after `startInput` now, and keeps it there as
// the start changes - until the rep sets a different end time, which is left
// alone. `skip()` says when there's no such default to show (a multi-day
// event with no end time runs to the end of its last day instead).
function wireDefaultEndTime(startInput, endInput, { minutes = () => DEFAULT_MINUTES, skip = () => false } = {}) {
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

function wireCardDefaultEndTime(card) {
  const date = card.querySelector(".field-date");
  const endDate = card.querySelector(".field-end-date");
  wireDefaultEndTime(card.querySelector(".field-time"), card.querySelector(".field-end-time"), {
    skip: () => endDate.value && endDate.value !== date.value,
  });
}

function fillCardFields(card, event) {
  card.querySelector(".field-title").value = event.title || "";
  card.querySelector(".field-date").value = event.date || "";
  card.querySelector(".field-end-date").value = event.end_date || "";
  card.querySelector(".field-time").value = event.time || "";
  card.querySelector(".field-end-time").value = event.end_time || "";
  card.querySelector(".field-description").value = event.description || "";
  card.querySelector(".field-location").value = event.location || "";
  card.querySelector(".field-url").value = event.url || "";
  card.querySelector(".field-recurrence").value = recurrenceToSelectValue(event.recurrence);
  card.querySelector(".field-recurrence-until").value = (event.recurrence && event.recurrence.until) || "";
}

function readCardFields(card) {
  const recurSelectValue = card.querySelector(".field-recurrence").value;
  const recurUntil = card.querySelector(".field-recurrence-until").value || null;
  const recurrence = recurSelectValue ? { ...RECURRENCE_OPTIONS[recurSelectValue], until: recurUntil } : null;
  return {
    title: card.querySelector(".field-title").value.trim(),
    date: card.querySelector(".field-date").value,
    end_date: card.querySelector(".field-end-date").value || null,
    time: card.querySelector(".field-time").value || null,
    end_time: card.querySelector(".field-end-time").value || null,
    description: card.querySelector(".field-description").value.trim() || null,
    location: card.querySelector(".field-location").value.trim() || null,
    url: card.querySelector(".field-url").value.trim() || null,
    year_group: card.querySelector(".field-year-group").checked,
    recurrence,
    exceptions: getCardExceptions(card),
  };
}

// Exceptions (single-occurrence move/cancel) are only offered on an
// already-saved recurring event (renderExistingEvents), never on a draft
// card - there's no series to override yet. The working list lives as
// JSON in a data attribute on the card, so it flows through the normal
// "Save changes" -> /api/events-update path with no separate endpoint.
function getCardExceptions(card) {
  try {
    return JSON.parse(card.dataset.exceptions || "[]");
  } catch {
    return [];
  }
}

function setCardExceptions(card, exceptions) {
  card.dataset.exceptions = JSON.stringify(exceptions);
  renderExceptionsList(card);
}

// " (RR only)" for an exception scoped to some of the year's classes; nothing
// for one that applies to every class (or on a class's own, unshared event).
function exceptionScopeText(exc) {
  const group = currentYearGroup();
  if (!group || !exc.classes || exc.classes.length === 0) return "";
  const labels = exc.classes
    .map((code) => group.classes.find((c) => c.code === code)?.label || code.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
  return ` (${labels.join(" and ")} only)`;
}

function formatExceptionSummary(exc) {
  const fmt = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const scope = exceptionScopeText(exc);
  if (exc.action === "cancelled") return `${fmt(exc.date)}: cancelled${scope}`;
  const timeText = exc.new_time ? ` at ${exc.new_time}${exc.new_end_time ? `–${exc.new_end_time}` : ""}` : "";
  return `${fmt(exc.date)}: moved to ${fmt(exc.new_date)}${timeText}${scope}`;
}

// Whether two same-date exceptions would clash: both unscoped (every class),
// or both scoped with a class in common. An unscoped one alongside a
// class-specific one is deliberate and fine - the build lets the specific one
// win (e.g. PE moved for the whole year, but cancelled for RR's class trip).
function exceptionScopesClash(a, b) {
  const aScoped = a.classes?.length > 0;
  const bScoped = b.classes?.length > 0;
  if (!aScoped && !bScoped) return true;
  if (aScoped && bScoped) return a.classes.some((code) => b.classes.includes(code));
  return false;
}

function renderExceptionsList(card) {
  const container = card.querySelector(".exceptions-list");
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
function wireExceptionsSection(card, initialExceptions, { shared = false } = {}) {
  card.dataset.exceptions = JSON.stringify(initialExceptions || []);
  renderExceptionsList(card);

  const section = card.querySelector(".field-exceptions");
  const recurrenceSelect = card.querySelector(".field-recurrence");
  const syncSectionVisibility = () => {
    section.hidden = !recurrenceSelect.value;
  };
  recurrenceSelect.addEventListener("change", syncSectionVisibility);
  syncSectionVisibility();

  const actionSelect = card.querySelector(".exception-action");
  const moveFields = card.querySelector(".exception-move-fields");
  const syncMoveFieldsVisibility = () => {
    moveFields.hidden = actionSelect.value !== "moved";
  };
  actionSelect.addEventListener("change", syncMoveFieldsVisibility);
  syncMoveFieldsVisibility();

  const scopeRow = card.querySelector(".exception-scope-row");
  const scopeSelect = card.querySelector(".exception-scope");
  const group = currentYearGroup();
  if (shared && group) {
    scopeSelect.innerHTML = "";
    scopeSelect.add(new Option(`All of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`, ""));
    for (const cls of sortedClasses(group)) scopeSelect.add(new Option(`${cls.label} only`, cls.code));
    scopeRow.hidden = false;
  }

  const dateInput = card.querySelector(".exception-date");
  const newDateInput = card.querySelector(".exception-new-date");
  const newTimeInput = card.querySelector(".exception-new-time");
  const newEndTimeInput = card.querySelector(".exception-new-end-time");
  // A moved occurrence keeps the event's own length, so a new start with no
  // new end doesn't quietly shorten (or lengthen) it.
  wireDefaultEndTime(newTimeInput, newEndTimeInput, {
    minutes: () => eventMinutes(card.querySelector(".field-time").value, card.querySelector(".field-end-time").value),
  });

  card.querySelector(".exception-add-button").addEventListener("click", () => {
    if (!dateInput.value) return;
    const errorEl = card.querySelector(".field-error");
    errorEl.hidden = true;
    const exception = { date: dateInput.value, action: actionSelect.value };
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
function wireRecurrenceToggle(card) {
  const select = card.querySelector(".field-recurrence");
  const untilLabel = card.querySelector(".field-recurrence-until-label");
  const sync = () => {
    untilLabel.hidden = !select.value;
  };
  select.addEventListener("change", sync);
  sync();
}

function updateDraftControlsVisibility() {
  el.saveAllButton.hidden = el.draftCards.children.length === 0;
}

function addDraftCard(event) {
  const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
  fillCardFields(node, event);
  wireCardDefaultEndTime(node);
  wireRecurrenceToggle(node);
  setupYearGroupControls(node);
  node.querySelector(".card-save-button").hidden = true; // drafts save via "Save all", not individually
  node.querySelector(".card-remove-button").addEventListener("click", () => {
    node.remove();
    updateDraftControlsVisibility();
  });
  el.draftCards.appendChild(node);
  updateDraftControlsVisibility();
}

async function handleSaveAll() {
  const cards = [...el.draftCards.querySelectorAll(".event-card")];
  if (cards.length === 0) return;

  el.saveError.hidden = true;
  let hasFieldError = false;
  const events = cards.map((card) => {
    const errorEl = card.querySelector(".field-error");
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

  const resp = await apiCall("/api/save", {
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
    armPublicConfirm(el.saveAllButton, "Save all", el.saveError, data.message, el.draftCards);
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
  updateDraftControlsVisibility();

  const listResult = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (listResult.ok) renderExistingEvents(listResult.data.events);
}

// The "What's on this week" WhatsApp list. No argument: this week (or next,
// on a Sunday - the server decides). `shiftDays` (-7/+7) steps from the week
// already showing.
async function handleWeekList(shiftDays) {
  el.weekListError.hidden = true;
  const buttons = [el.weekListButton, el.weekPrevButton, el.weekNextButton];
  buttons.forEach((b) => (b.disabled = true));

  const body = { calendar: state.calendar, passcode: state.passcode };
  if (shiftDays && state.weekStart) body.week_start = shiftIsoDate(state.weekStart, shiftDays);
  const { ok, data } = await apiCall("/api/week", body);

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

function shiftIsoDate(iso, days) {
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

function formatEventDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// The date, plus the start (and end) time when the event has one.
function formatEventWhen(event) {
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
function renderWholeSchoolEvents(events) {
  el.schoolEventsNotice.hidden = true;
  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.existingEmpty.hidden = events.length > 0;

  for (const event of events) {
    el.existingCards.appendChild(createSchoolEventCard(event));
  }
}

// The same card also stands in for a school-sourced event in a class's own
// list (event.school_event), where it's flagged as coming from the school's
// calendar - and, if the sibling class has it too, as shared with the year.
function createSchoolEventCard(event) {
  const node = el.wholeSchoolCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector(".ws-title").textContent = event.title;
  node.querySelector(".ws-date").textContent = formatEventWhen(event);
  node.querySelector(".field-description").value = event.description || "";
  node.querySelector(".field-location").value = event.location || "";

  if (event.school_event) {
    node.querySelector(".ws-flag").hidden = false;
    const group = currentYearGroup();
    if (event.year_group && group) {
      node.querySelector(".ws-shared-note").textContent = `Shared with ${yearGroupDescription(group)} - changes apply to every class.`;
    }
  }

  // What the server last had, to send back only the fields a rep actually
  // changed - saving a location alone must not also store the school's
  // current description as an override (which would then stop following
  // the school's own edits to it).
  const saved = { description: (event.description || "").trim(), location: event.location || "" };
  const saveButton = node.querySelector(".card-save-button");
  saveButton.addEventListener("click", () => handleUpdateWholeSchoolEvent(node, event.id, saveButton, saved));
  return node;
}

async function handleUpdateWholeSchoolEvent(card, id, button, saved) {
  const errorEl = card.querySelector(".field-error");
  errorEl.hidden = true;
  const description = card.querySelector(".field-description").value.trim();
  const location = card.querySelector(".field-location").value.replace(/\s+/g, " ").trim();

  const changes = {};
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

  const resp = await apiCall("/api/events-update", {
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
    armPublicConfirm(button, originalText, errorEl, data.message, card);
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

function renderExistingEvents(events) {
  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.existingEmpty.hidden = events.length > 0;

  el.schoolEventsNotice.hidden = !events.some((e) => e.school_event);

  for (const event of events) {
    if (event.school_event) {
      el.existingCards.appendChild(createSchoolEventCard(event));
      continue;
    }
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    fillCardFields(node, event);
    wireCardDefaultEndTime(node);
    wireRecurrenceToggle(node);
    wireExceptionsSection(node, event.exceptions, { shared: Boolean(event.year_group) });
    setupYearGroupControls(node, { saved: true, shared: Boolean(event.year_group) });

    const saveButton = node.querySelector(".card-save-button");
    saveButton.hidden = false;
    saveButton.addEventListener("click", () => handleUpdateExisting(node, event.id, saveButton));

    const removeButton = node.querySelector(".card-remove-button");
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => handleDeleteExisting(node, event.id, removeButton));

    el.existingCards.appendChild(node);
  }
}

async function handleUpdateExisting(card, id, button) {
  const errorEl = card.querySelector(".field-error");
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

  const resp = await apiCall("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id,
    event: value,
    ...confirmPublicField(button),
  });
  const { ok, data } = resp;

  button.disabled = false;
  if (isConfirmPublic(resp)) {
    armPublicConfirm(button, originalText, errorEl, data.message, card);
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

async function handleDeleteExisting(card, id, button) {
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
  const { ok, data } = await apiCall("/api/events-delete", { calendar: state.calendar, passcode: state.passcode, id });

  if (!ok) {
    const errorEl = card.querySelector(".field-error");
    errorEl.textContent = (data && data.message) || "Couldn't delete - try again.";
    errorEl.hidden = false;
    button.disabled = false;
    button.classList.remove("confirm");
    button.textContent = "Delete";
    return;
  }

  card.remove();
  el.existingEmpty.hidden = el.existingCards.children.length > 0;
}

init();
