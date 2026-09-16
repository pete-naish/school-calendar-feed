// Mirrors ALL_CALENDARS in functions/api/_shared/calendars.js (and
// YEAR_GROUPS in scripts/build_ics.py) - keep the three in sync by hand.
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

const ALL_CALENDARS = [
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
  el.loginButton.addEventListener("click", handleLogin);
  el.switchCalendarButton.addEventListener("click", handleSwitchCalendar);
  el.extractButton.addEventListener("click", handleExtract);
  el.addManualCardButton.addEventListener("click", () => addDraftCard(blankEvent()));
  el.saveAllButton.addEventListener("click", handleSaveAll);
}

function blankEvent() {
  return { title: "", date: "", time: null, end_time: null, description: null, url: null };
}

function updateLoginButtonState() {
  el.loginButton.disabled = !(el.calendarSelect.value && el.passcodeInput.value);
}

function calendarLabelFor(code) {
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
  renderExistingEvents(data.events);
}

function handleSwitchCalendar() {
  state.calendar = null;
  state.passcode = null;
  el.passcodeInput.value = "";
  el.pasteTextarea.value = "";
  el.draftCards.innerHTML = "";
  el.existingCards.innerHTML = "";
  el.addManualCardButton.hidden = true;
  el.saveAllButton.hidden = true;
  el.saveSuccess.hidden = true;
  el.appSection.hidden = true;
  el.loginSection.hidden = false;
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
  el.addManualCardButton.hidden = false;
  el.saveAllButton.hidden = false;
  el.pasteTextarea.value = "";
}

function fillCardFields(card, event) {
  card.querySelector(".field-title").value = event.title || "";
  card.querySelector(".field-date").value = event.date || "";
  card.querySelector(".field-time").value = event.time || "";
  card.querySelector(".field-end-time").value = event.end_time || "";
  card.querySelector(".field-description").value = event.description || "";
  card.querySelector(".field-url").value = event.url || "";
}

function readCardFields(card) {
  return {
    title: card.querySelector(".field-title").value.trim(),
    date: card.querySelector(".field-date").value,
    time: card.querySelector(".field-time").value || null,
    end_time: card.querySelector(".field-end-time").value || null,
    description: card.querySelector(".field-description").value.trim() || null,
    url: card.querySelector(".field-url").value.trim() || null,
  };
}

function addDraftCard(event) {
  const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
  fillCardFields(node, event);
  node.querySelector(".card-save-button").hidden = true; // drafts save via "Save all", not individually
  node.querySelector(".card-remove-button").addEventListener("click", () => node.remove());
  el.draftCards.appendChild(node);
}

async function handleSaveAll() {
  const cards = [...el.draftCards.querySelectorAll(".event-card")];
  if (cards.length === 0) return;

  el.saveError.hidden = true;
  let hasFieldError = false;
  const events = cards.map((card) => {
    const errorEl = card.querySelector(".field-error");
    const value = readCardFields(card);
    if (!value.title || !value.date) {
      errorEl.textContent = "Title and date are required.";
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
  el.saveSuccess.textContent = `${data.saved} event(s) saved${skipped}. They'll appear in the calendar within 6 hours.`;
  el.saveSuccess.hidden = false;
  el.draftCards.innerHTML = "";
  el.addManualCardButton.hidden = true;
  el.saveAllButton.hidden = true;

  const listResult = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (listResult.ok) renderExistingEvents(listResult.data.events);
}

function renderExistingEvents(events) {
  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.existingEmpty.hidden = events.length > 0;

  for (const event of events) {
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    fillCardFields(node, event);

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
  if (!value.title || !value.date) {
    errorEl.textContent = "Title and date are required.";
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
