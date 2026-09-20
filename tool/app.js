// Mirrors ALL_CALENDARS in functions/api/_shared/calendars.js (and
// YEAR_GROUPS in scripts/build_ics.py) - keep the three in sync by hand
// (scripts/check_config_sync.py checks this on every push).
const YEAR_GROUPS = [
  { label: "Reception", classes: [{ code: "rr", label: "RR" }, { code: "rgp", label: "RGP" }] },
  { label: "Year 1", classes: [{ code: "1ms", label: "1MS" }, { code: "1t", label: "1T" }] },
  { label: "Year 2", classes: [{ code: "2ly", label: "2LY" }, { code: "2s", label: "2S" }] },
  { label: "Year 3", classes: [{ code: "3b", label: "3B" }, { code: "3d", label: "3D" }] },
  { label: "Year 4", classes: [{ code: "4m", label: "4M" }, { code: "4w", label: "4W" }] },
  { label: "Year 5", classes: [{ code: "5l", label: "5L" }, { code: "5hp", label: "5HP" }] },
  { label: "Year 6", classes: [{ code: "6bt", label: "6BT" }, { code: "6r", label: "6R" }] },
];
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

const ALL_CALENDARS = [
  { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
  ...YEAR_GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, yearLabel: g.label }))),
  { ...FOSPS, yearLabel: "Friends of St Paul's" },
];

const state = {
  calendar: null,
  passcode: null,
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
  cardTemplate: document.getElementById("event-card-template"),
};

function init() {
  const wholeSchoolOpt = document.createElement("option");
  wholeSchoolOpt.value = WHOLE_SCHOOL.code;
  wholeSchoolOpt.textContent = WHOLE_SCHOOL.label;
  el.calendarSelect.appendChild(wholeSchoolOpt);

  for (const group of YEAR_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const cls of group.classes) {
      const opt = document.createElement("option");
      opt.value = cls.code;
      opt.textContent = cls.label;
      optgroup.appendChild(opt);
    }
    el.calendarSelect.appendChild(optgroup);
  }
  const fospsOpt = document.createElement("option");
  fospsOpt.value = FOSPS.code;
  fospsOpt.textContent = "FOSPS";
  el.calendarSelect.appendChild(fospsOpt);

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
}

// The year group the signed-in calendar belongs to ({label, classes}), or
// undefined for FOSPS / Whole School. Events for "all of Year 1" are shared
// by every class in the year (see functions/api/_shared/calendars.js's
// yearGroupFor()).
function currentYearGroup() {
  return YEAR_GROUPS.find((g) => g.classes.some((c) => c.code === state.calendar));
}

function yearGroupDescription(group) {
  return `all of ${group.label} (${group.classes.map((c) => c.label).join(" and ")})`;
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
      el.loginError.textContent = (data && data.error) || "Something went wrong - try again.";
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
  const labels = exc.classes.map((code) => group.classes.find((c) => c.code === code)?.label || code.toUpperCase());
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
    scopeSelect.add(new Option(`All of ${group.label} (${group.classes.map((c) => c.label).join(" and ")})`, ""));
    for (const cls of group.classes) scopeSelect.add(new Option(`${cls.label} only`, cls.code));
    scopeRow.hidden = false;
  }

  const dateInput = card.querySelector(".exception-date");
  const newDateInput = card.querySelector(".exception-new-date");
  const newTimeInput = card.querySelector(".exception-new-time");
  const newEndTimeInput = card.querySelector(".exception-new-end-time");

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

  const { ok, data } = await apiCall("/api/save", { calendar: state.calendar, passcode: state.passcode, events });

  el.saveAllButton.disabled = false;
  el.saveAllButton.textContent = "Save all";

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

function formatEventDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Whole School events aren't stored/edited like a normal manual event -
// title/date/recurrence/etc all come from the school's own feed and can't
// be changed here, so this renders a much simpler read-mostly card (see
// #whole-school-event-template) instead of the full event-card-template
// used everywhere else, with only description + location fields and one
// save button.
function renderWholeSchoolEvents(events) {
  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.existingEmpty.hidden = events.length > 0;

  for (const event of events) {
    const node = el.wholeSchoolCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".ws-title").textContent = event.title;
    node.querySelector(".ws-date").textContent = formatEventDate(event.date);
    node.querySelector(".field-description").value = event.description || "";
    node.querySelector(".field-location").value = event.location || "";

    // What the server last had, to send back only the fields a rep actually
    // changed - saving a location alone must not also store the school's
    // current description as an override (which would then stop following
    // the school's own edits to it).
    const saved = { description: (event.description || "").trim(), location: event.location || "" };
    const saveButton = node.querySelector(".card-save-button");
    saveButton.addEventListener("click", () => handleUpdateWholeSchoolEvent(node, event.id, saveButton, saved));

    el.existingCards.appendChild(node);
  }
}

async function handleUpdateWholeSchoolEvent(card, id, button, saved) {
  const errorEl = card.querySelector(".field-error");
  errorEl.hidden = true;
  const description = card.querySelector(".field-description").value.trim();
  const location = card.querySelector(".field-location").value.replace(/\s+/g, " ").trim();

  const changes = {};
  if (description !== saved.description) changes.description = description;
  if (location !== saved.location) changes.location = location;

  const originalText = button.textContent;
  if (Object.keys(changes).length === 0) {
    button.textContent = "No changes";
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
    return;
  }

  button.disabled = true;
  button.textContent = "Saving…";

  const { ok, data } = await apiCall("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id,
    ...changes,
  });

  button.disabled = false;
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

  for (const event of events) {
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    fillCardFields(node, event);
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
  const originalText = button.textContent;
  button.textContent = "Saving…";

  const { ok, data } = await apiCall("/api/events-update", {
    calendar: state.calendar,
    passcode: state.passcode,
    id,
    event: value,
  });

  button.disabled = false;
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
