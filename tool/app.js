import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic, isPastEvent } from "./appHelpers.js";
// The element `selector` finds inside `root`. The page's templates always
// have it, so a miss is a bug - which throws on first use, as it always has.
function find(root, selector) {
    return root.querySelector(selector);
}
// The year groups and their classes: fetched from GET /api/calendars at
// start-up (see loadCalendars()), which serves docs/classes.js - the single
// source of truth for class codes and labels. Empty until then.
let YEAR_GROUPS = [];
let ALL_CALENDARS = [];
const FOSPS = { code: "fosps", label: "FOSPS" };
// Restricted entry - description/location editing only, see calendars.ts's
// WHOLE_SCHOOL and isWholeSchoolCalendar() on the server side.
const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School" };
const RECURRENCE_OPTIONS = {
    daily: { freq: "DAILY", interval: 1 },
    weekly: { freq: "WEEKLY", interval: 1 },
    fortnightly: { freq: "WEEKLY", interval: 2 },
    monthly: { freq: "MONTHLY", interval: 1 },
};
function recurrenceToSelectValue(recurrence) {
    if (!recurrence)
        return "";
    if (recurrence.freq === "DAILY")
        return "daily";
    if (recurrence.freq === "WEEKLY" && recurrence.interval === 2)
        return "fortnightly";
    if (recurrence.freq === "WEEKLY")
        return "weekly";
    if (recurrence.freq === "MONTHLY")
        return "monthly";
    return ""; // an interval/freq combination the picker can't represent - treated as non-recurring here
}
// A year group's classes alphabetised by label, for listing them to reps -
// the same order as the public site's calendar list (displayOrder() in
// docs/assets/calendar.ts). YEAR_GROUPS itself stays in config order.
function sortedClasses(group) {
    return [...group.classes].sort((a, b) => a.label.localeCompare(b.label));
}
function setYearGroups(groups) {
    YEAR_GROUPS = groups;
    ALL_CALENDARS = [
        { ...WHOLE_SCHOOL, yearLabel: "Whole School" },
        { ...FOSPS, yearLabel: "Friends of St Paul's" },
        ...YEAR_GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, yearLabel: g.label }))),
    ];
}
const state = {
    calendar: null,
    passcode: null,
    weekStart: null, // Monday (YYYY-MM-DD) of the week showing in the weekly list
};
// The page's own elements - always there, since index.html and this ship together.
function byId(id) {
    return document.getElementById(id);
}
const el = {
    calendarSelect: byId("calendar-select"),
    passcodeInput: byId("passcode-input"),
    loginButton: byId("login-button"),
    loginError: byId("login-error"),
    loginSection: byId("login-section"),
    appSection: byId("app-section"),
    activeCalendarName: byId("active-calendar-name"),
    switchCalendarButton: byId("switch-calendar-button"),
    wholeSchoolNotice: byId("whole-school-notice"),
    addSection: byId("add-section"),
    wholeSchoolCardTemplate: byId("whole-school-event-template"),
    pasteTextarea: byId("paste-textarea"),
    extractButton: byId("extract-button"),
    extractError: byId("extract-error"),
    extractLoading: byId("extract-loading"),
    draftCards: byId("draft-cards"),
    addManualCardButton: byId("add-manual-card-button"),
    saveAllButton: byId("save-all-button"),
    saveError: byId("save-error"),
    saveSuccess: byId("save-success"),
    existingLoading: byId("existing-loading"),
    existingEmpty: byId("existing-empty"),
    existingCards: byId("existing-cards"),
    pastEvents: byId("past-events"),
    pastCount: byId("past-count"),
    pastCards: byId("past-cards"),
    schoolEventsNotice: byId("school-events-notice"),
    cardTemplate: byId("event-card-template"),
    weekListButton: byId("week-list-button"),
    weekListError: byId("week-list-error"),
    weekListPanel: byId("week-list-panel"),
    weekListLabel: byId("week-list-label"),
    weekListOutput: byId("week-list-output"),
    weekPrevButton: byId("week-prev-button"),
    weekNextButton: byId("week-next-button"),
    weekCopyButton: byId("week-copy-button"),
};
// Fills the calendar picker once the class list has arrived. Until then the
// picker only holds its "Choose a calendar…" placeholder, so login stays
// disabled; if the list can't be fetched, say so rather than show an empty picker.
async function loadCalendars() {
    let data = null;
    try {
        const resp = await fetch("/api/calendars");
        if (resp.ok)
            data = await resp.json();
    }
    catch {
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
        if (e.key === "Enter" && !el.loginButton.disabled)
            handleLogin();
    });
    el.loginButton.addEventListener("click", handleLogin);
    el.switchCalendarButton.addEventListener("click", handleSwitchCalendar);
    el.extractButton.addEventListener("click", handleExtract);
    el.pasteTextarea.addEventListener("input", updateExtractButtonState);
    updateExtractButtonState();
    el.addManualCardButton.addEventListener("click", () => addDraftCard(blankEvent()));
    el.saveAllButton.addEventListener("click", handleSaveAll);
    el.weekListButton.addEventListener("click", () => handleWeekList());
    el.weekPrevButton.addEventListener("click", () => handleWeekList(-7));
    el.weekNextButton.addEventListener("click", () => handleWeekList(7));
    el.weekCopyButton.addEventListener("click", handleCopyWeekList);
    window.addEventListener("beforeunload", (e) => {
        if (state.calendar && hasUnsavedWork())
            e.preventDefault();
    });
}
// What switching calendar or leaving the page would lose: pasted text not yet
// extracted, new events not yet saved, or a saved event with unsaved edits
// (see setDirty()).
function hasUnsavedWork() {
    const text = el.pasteTextarea.value.trim();
    return ((text !== "" && text !== lastExtractedText) ||
        el.draftCards.children.length > 0 ||
        el.appSection.querySelector("[data-dirty]") !== null);
}
// The year group the signed-in calendar belongs to ({label, classes}), or
// undefined for FOSPS / Whole School. Events for "all of Year 1" are shared
// by every class in the year (see functions/api/_shared/calendars.ts's
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
    const toggle = find(card, ".field-year-group-label");
    const note = find(card, ".year-group-note");
    toggle.hidden = true;
    note.hidden = true;
    if (!group)
        return;
    if (shared) {
        note.textContent = `Shared with ${yearGroupDescription(group)} - editing or deleting it changes it for every class (an exception can be limited to one class, though).`;
        note.hidden = false;
    }
    else if (!saved) {
        find(card, ".field-year-group-text").textContent = `Add to ${yearGroupDescription(group)}`;
        toggle.hidden = false;
    }
}
function blankEvent() {
    return { title: "", date: "", end_date: null, time: null, end_time: null, description: null, location: null, url: null, recurrence: null };
}
// A same-day end time at or before its start (validate.ts refuses it too). On
// a multi-day event the end time is on the last day, so anything goes.
function endsBeforeStart(start, end) {
    return Boolean(start && end && end <= start);
}
function localValidationError(value) {
    if (!value.title || !value.date)
        return "Title and date are required.";
    if (value.end_date && value.end_date < value.date)
        return "End date can't be before the start date.";
    if ((!value.end_date || value.end_date === value.date) && endsBeforeStart(value.time, value.end_time)) {
        return "The end time must be after the start time.";
    }
    if (value.recurrence && !value.recurrence.until)
        return "Repeat until date is required for a repeating event.";
    return null;
}
function updateLoginButtonState() {
    el.loginButton.disabled = !(el.calendarSelect.value && el.passcodeInput.value);
}
function calendarLabelFor(code) {
    if (code === WHOLE_SCHOOL.code)
        return WHOLE_SCHOOL.label;
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
    }
    catch {
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
        }
        else {
            // e.g. 429 rate_limited (see _shared/auth.ts) - data.message is written
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
        renderWholeSchoolEvents(data.events);
    }
    else {
        renderExistingEvents(data.events);
    }
}
let switchDisarmTimer;
function disarmSwitchCalendar() {
    clearTimeout(switchDisarmTimer);
    delete el.switchCalendarButton.dataset.armed;
    el.switchCalendarButton.classList.remove("confirm");
    el.switchCalendarButton.textContent = "Switch calendar";
}
// With unsaved work on the page, the first click says it'll be lost and the
// second (within a few seconds) switches anyway.
function handleSwitchCalendar() {
    if (hasUnsavedWork() && el.switchCalendarButton.dataset.armed !== "1") {
        el.switchCalendarButton.dataset.armed = "1";
        el.switchCalendarButton.classList.add("confirm");
        el.switchCalendarButton.textContent = "Unsaved changes will be lost - click again to switch";
        switchDisarmTimer = setTimeout(disarmSwitchCalendar, 8000);
        return;
    }
    disarmSwitchCalendar();
    state.calendar = null;
    state.passcode = null;
    el.passcodeInput.value = "";
    el.pasteTextarea.value = "";
    lastExtractedText = "";
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
    state.weekStart = null;
    el.appSection.hidden = true;
    el.addSection.hidden = false;
    el.wholeSchoolNotice.hidden = true;
    el.loginSection.hidden = false;
    updateDraftControlsVisibility();
    updateLoginButtonState();
}
// The pasted text events were last extracted from (trimmed), and whether an
// extraction is running. "Extract events" stays disabled until there's text it
// hasn't already been through, so a second press can't add every event twice.
let lastExtractedText = "";
let extracting = false;
function updateExtractButtonState() {
    const text = el.pasteTextarea.value.trim();
    el.extractButton.disabled = extracting || !text || text === lastExtractedText;
}
async function handleExtract() {
    const text = el.pasteTextarea.value;
    if (!text.trim())
        return;
    el.extractError.hidden = true;
    el.extractLoading.hidden = false;
    extracting = true;
    updateExtractButtonState();
    const { ok, data } = await apiCall("/api/parse", { calendar: state.calendar, passcode: state.passcode, text });
    el.extractLoading.hidden = true;
    extracting = false;
    if (ok && data.events?.length)
        lastExtractedText = text.trim();
    updateExtractButtonState();
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
function addMinutes(time, minutes) {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + minutes;
    if (total >= 24 * 60)
        return null;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
// A timed event's length in minutes: start to end, or the default hour when
// it has no end time (the build publishes it that way, scripts/build_ics.py).
function eventMinutes(start, end) {
    if (!start || !end)
        return DEFAULT_MINUTES;
    const toMinutes = (t) => t.split(":").map(Number).reduce((h, m) => h * 60 + m);
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
        if (untouched)
            endInput.value = (start && !skip() && addMinutes(start, lastMinutes)) || "";
    };
    startInput.addEventListener("input", sync);
    sync();
}
function wireCardDefaultEndTime(card) {
    const date = find(card, ".field-date");
    const endDate = find(card, ".field-end-date");
    wireDefaultEndTime(find(card, ".field-time"), find(card, ".field-end-time"), {
        skip: () => Boolean(endDate.value && endDate.value !== date.value),
    });
}
function fillCardFields(card, event) {
    find(card, ".field-title").value = event.title || "";
    find(card, ".field-date").value = event.date || "";
    find(card, ".field-end-date").value = event.end_date || "";
    find(card, ".field-time").value = event.time || "";
    find(card, ".field-end-time").value = event.end_time || "";
    find(card, ".field-description").value = event.description || "";
    find(card, ".field-location").value = event.location || "";
    find(card, ".field-url").value = event.url || "";
    find(card, ".field-recurrence").value = recurrenceToSelectValue(event.recurrence);
    find(card, ".field-recurrence-until").value = (event.recurrence && event.recurrence.until) || "";
}
function readCardFields(card) {
    const recurSelectValue = find(card, ".field-recurrence").value;
    const recurUntil = find(card, ".field-recurrence-until").value || null;
    const recurrence = recurSelectValue ? { ...RECURRENCE_OPTIONS[recurSelectValue], until: recurUntil } : null;
    return {
        title: find(card, ".field-title").value.trim(),
        date: find(card, ".field-date").value,
        end_date: find(card, ".field-end-date").value || null,
        time: find(card, ".field-time").value || null,
        end_time: find(card, ".field-end-time").value || null,
        description: find(card, ".field-description").value.trim() || null,
        location: find(card, ".field-location").value.trim() || null,
        url: find(card, ".field-url").value.trim() || null,
        year_group: find(card, ".field-year-group").checked,
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
    }
    catch {
        return [];
    }
}
// A rep adding or removing one; nothing is stored until "Save changes".
function setCardExceptions(card, exceptions) {
    card.dataset.exceptions = JSON.stringify(exceptions);
    renderExceptionsList(card);
    setDirty(card, true);
    find(card, ".exceptions-unsaved").hidden = false;
}
// " (RR only)" for an exception scoped to some of the year's classes; nothing
// for one that applies to every class (or on a class's own, unshared event).
function exceptionScopeText(exc) {
    const group = currentYearGroup();
    if (!group || !exc.classes || exc.classes.length === 0)
        return "";
    const labels = exc.classes
        .map((code) => group.classes.find((c) => c.code === code)?.label || code.toUpperCase())
        .sort((a, b) => a.localeCompare(b));
    return ` (${labels.join(" and ")} only)`;
}
function formatExceptionSummary(exc) {
    const fmt = formatDayDate;
    const scope = exceptionScopeText(exc);
    if (exc.action === "cancelled")
        return `${fmt(exc.date)}: cancelled${scope}`;
    const timeText = exc.new_time ? ` at ${exc.new_time}${exc.new_end_time ? `–${exc.new_end_time}` : ""}` : "";
    return `${fmt(exc.date)}: moved to ${fmt(exc.new_date)}${timeText}${scope}`;
}
// Whether two same-date exceptions would clash: both unscoped (every class),
// or both scoped with a class in common. An unscoped one alongside a
// class-specific one is deliberate and fine - the build lets the specific one
// win (e.g. PE moved for the whole year, but cancelled for RR's class trip).
function exceptionScopesClash(a, b) {
    const aScoped = (a.classes?.length ?? 0) > 0;
    const bScoped = (b.classes?.length ?? 0) > 0;
    if (!aScoped && !bScoped)
        return true;
    if (aScoped && bScoped)
        return a.classes.some((code) => b.classes.includes(code));
    return false;
}
function renderExceptionsList(card) {
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
function wireExceptionsSection(card, initialExceptions, { shared = false } = {}) {
    card.dataset.exceptions = JSON.stringify(initialExceptions || []);
    renderExceptionsList(card);
    const section = find(card, ".field-exceptions");
    const recurrenceSelect = find(card, ".field-recurrence");
    const syncSectionVisibility = () => {
        section.hidden = !recurrenceSelect.value;
    };
    recurrenceSelect.addEventListener("change", syncSectionVisibility);
    syncSectionVisibility();
    const actionSelect = find(card, ".exception-action");
    const moveFields = find(card, ".exception-move-fields");
    const syncMoveFieldsVisibility = () => {
        moveFields.hidden = actionSelect.value !== "moved";
    };
    actionSelect.addEventListener("change", syncMoveFieldsVisibility);
    syncMoveFieldsVisibility();
    const scopeRow = find(card, ".exception-scope-row");
    const scopeSelect = find(card, ".exception-scope");
    const group = currentYearGroup();
    if (shared && group) {
        scopeSelect.innerHTML = "";
        scopeSelect.add(new Option(`All of ${group.label} (${sortedClasses(group).map((c) => c.label).join(" and ")})`, ""));
        for (const cls of sortedClasses(group))
            scopeSelect.add(new Option(`${cls.label} only`, cls.code));
        scopeRow.hidden = false;
    }
    const dateInput = find(card, ".exception-date");
    const newDateInput = find(card, ".exception-new-date");
    const newTimeInput = find(card, ".exception-new-time");
    const newEndTimeInput = find(card, ".exception-new-end-time");
    // A moved occurrence keeps the event's own length, so a new start with no
    // new end doesn't quietly shorten (or lengthen) it.
    wireDefaultEndTime(newTimeInput, newEndTimeInput, {
        minutes: () => eventMinutes(find(card, ".field-time").value, find(card, ".field-end-time").value),
    });
    find(card, ".exception-add-button").addEventListener("click", () => {
        const errorEl = find(card, ".field-error");
        errorEl.hidden = true;
        const refuse = (message) => {
            errorEl.textContent = message;
            errorEl.hidden = false;
        };
        if (!dateInput.value)
            return refuse("Choose the date of the occurrence to change.");
        // Built up field by field; the select only offers "cancelled" and "moved".
        const exception = { date: dateInput.value, action: actionSelect.value };
        if (!scopeRow.hidden && scopeSelect.value)
            exception.classes = [scopeSelect.value];
        if (exception.action === "moved") {
            if (!newDateInput.value)
                return refuse("Choose the date to move it to.");
            exception.new_date = newDateInput.value;
            exception.new_time = newTimeInput.value || null;
            exception.new_end_time = newEndTimeInput.value || null;
            // With no new start it keeps the event's own times (see validate.ts).
            const start = exception.new_time || find(card, ".field-time").value || null;
            const end = exception.new_time ? exception.new_end_time : exception.new_end_time || find(card, ".field-end-time").value || null;
            if (endsBeforeStart(start, end))
                return refuse("The new end time must be after the start time.");
        }
        const clash = getCardExceptions(card).find((e) => e.date === exception.date && exceptionScopesClash(e, exception));
        if (clash)
            return refuse(`There's already an exception on that date${exceptionScopeText(clash)} - remove it first to change it.`);
        setCardExceptions(card, [...getCardExceptions(card), exception]);
        dateInput.value = "";
        newDateInput.value = "";
        newTimeInput.value = "";
        newEndTimeInput.value = "";
        refreshWeekdayHints(card);
    });
}
// Shows the "Repeat until" field only once a repeat frequency is picked.
function wireRecurrenceToggle(card) {
    const select = find(card, ".field-recurrence");
    const untilLabel = find(card, ".field-recurrence-until-label");
    const sync = () => {
        untilLabel.hidden = !select.value;
    };
    select.addEventListener("change", sync);
    sync();
}
// --- Weekdays under date boxes ----------------------------------------------
//
// A date box shows 09/10/2026 but not that it's a Friday, which is how a date
// that's a day out (easy when "next Thursday" was read from pasted text)
// gets spotted.
function formatWeekday(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" });
}
function addWeekdayHints(root) {
    for (const input of root.querySelectorAll('input[type="date"]')) {
        const hint = document.createElement("span");
        hint.className = "weekday hint";
        input.after(hint);
    }
    root.addEventListener("input", () => refreshWeekdayHints(root));
    refreshWeekdayHints(root);
}
// Also needed after setting a date box's value from code, which fires no event.
function refreshWeekdayHints(root) {
    for (const hint of root.querySelectorAll(".weekday")) {
        const input = hint.previousElementSibling;
        hint.textContent = input.value ? formatWeekday(input.value) : "";
    }
}
// --- Folded saved events ----------------------------------------------------
//
// A saved event's card starts folded to a summary line (title, when, badges)
// so a long list can be scanned; clicking the summary opens the form. Draft
// cards have no summary and are always open.
function isCardOpen(card) {
    return find(card, ".card-summary").getAttribute("aria-expanded") === "true";
}
function setCardOpen(card, open) {
    find(card, ".card-summary").setAttribute("aria-expanded", String(open));
    find(card, ".card-body").hidden = !open;
}
function setupFolding(card) {
    const summary = find(card, ".card-summary");
    summary.hidden = false;
    summary.addEventListener("click", () => setCardOpen(card, !isCardOpen(card)));
    setCardOpen(card, false);
}
function setSummary(card, title, when, tags) {
    find(card, ".card-summary-title").textContent = title || "(No title)";
    find(card, ".card-summary-when").textContent = when;
    const container = find(card, ".card-summary-tags");
    container.innerHTML = "";
    for (const tag of tags) {
        const badge = document.createElement("span");
        badge.className = tag.warning ? "badge badge-warning" : "badge";
        badge.textContent = tag.text;
        container.append(badge, " ");
    }
}
const RECURRENCE_LABELS = {
    daily: "Daily",
    weekly: "Weekly",
    fortnightly: "Every 2 weeks",
    monthly: "Monthly",
};
// "Thu 9 Oct 2026, 15:30–16:30 · Weekly until Thu 17 Dec 2026 · 1 exception"
function manualEventWhen(event) {
    let when = event.date ? formatDayDate(event.date) : "No date";
    if (event.end_date && event.end_date !== event.date)
        when += ` – ${formatDayDate(event.end_date)}`;
    if (event.time)
        when += `, ${event.time}${event.end_time ? `–${event.end_time}` : ""}`;
    const repeat = RECURRENCE_LABELS[recurrenceToSelectValue(event.recurrence)];
    if (repeat)
        when += ` · ${repeat}${event.recurrence?.until ? ` until ${formatDayDate(event.recurrence.until)}` : ""}`;
    const exceptions = event.exceptions?.length ?? 0;
    if (exceptions)
        when += ` · ${exceptions} exception${exceptions === 1 ? "" : "s"}`;
    return when;
}
function setManualSummary(card, event) {
    const group = currentYearGroup();
    const tags = card.dataset.shared && group ? [{ text: `All of ${group.label}` }] : [];
    setSummary(card, event.title, manualEventWhen(event), tags);
}
// --- Unsaved changes --------------------------------------------------------
//
// A saved event's card is marked once a rep edits it, until it's saved: it
// says so (in the summary too, so it shows while folded), it survives the
// list reloading after another save, and switching calendar or leaving the
// page asks first. Typing in the exception or date-correction forms doesn't
// count - neither changes the event until it's added or saved itself.
function setDirty(card, dirty) {
    if (dirty)
        card.dataset.dirty = "1";
    else
        delete card.dataset.dirty;
    find(card, ".card-summary-unsaved").hidden = !dirty;
    find(card, ".card-unsaved").hidden = !dirty;
    const exceptionsNote = card.querySelector(".exceptions-unsaved");
    if (exceptionsNote && !dirty)
        exceptionsNote.hidden = true;
}
function trackChanges(card) {
    const onEdit = (e) => {
        if (e.target.closest(".exception-add-form, .date-correction"))
            return;
        setDirty(card, true);
    };
    card.addEventListener("input", onEdit);
    card.addEventListener("change", onEdit);
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
    addWeekdayHints(node);
    find(node, ".card-save-button").hidden = true; // drafts save via "Save all", not individually
    find(node, ".card-remove-button").addEventListener("click", () => {
        node.remove();
        updateDraftControlsVisibility();
    });
    el.draftCards.appendChild(node);
    updateDraftControlsVisibility();
}
async function handleSaveAll() {
    const cards = [...el.draftCards.querySelectorAll(".event-card")];
    if (cards.length === 0)
        return;
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
        }
        else {
            errorEl.hidden = true;
        }
        return value;
    });
    if (hasFieldError)
        return;
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
    updateExtractButtonState();
    updateDraftControlsVisibility();
    const listResult = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
    if (listResult.ok)
        renderExistingEvents(listResult.data.events);
}
// The "What's on this week" WhatsApp list. No argument: this week (or next,
// on a Sunday - the server decides). `shiftDays` (-7/+7) steps from the week
// already showing.
async function handleWeekList(shiftDays) {
    el.weekListError.hidden = true;
    const buttons = [el.weekListButton, el.weekPrevButton, el.weekNextButton];
    buttons.forEach((b) => (b.disabled = true));
    const body = {
        calendar: state.calendar,
        passcode: state.passcode,
    };
    if (shiftDays && state.weekStart)
        body.week_start = shiftIsoDate(state.weekStart, shiftDays);
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
    }
    catch {
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
// Today's date (YYYY-MM-DD) in London, where the school is - not the
// browser's own timezone.
function todayIso() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
// Upcoming events in date order, then past ones newest first in the folded
// "Past events" section, so the list a rep lands on doesn't fill up with
// last term's events.
//
// On a reload (after saving new events, say) a card with unsaved edits is
// kept as it is rather than replaced, so the edits aren't lost, and a card
// that was open stays open.
function renderEventLists(events, makeCard) {
    const previous = new Map();
    for (const card of [...el.existingCards.children, ...el.pastCards.children]) {
        if (card.dataset.id)
            previous.set(card.dataset.id, card);
    }
    const cardFor = (event) => {
        const old = previous.get(event.id);
        if (old?.dataset.dirty)
            return old;
        const card = makeCard(event);
        if (old && isCardOpen(old))
            setCardOpen(card, true);
        return card;
    };
    el.existingLoading.hidden = true;
    el.existingCards.innerHTML = "";
    el.pastCards.innerHTML = "";
    const today = todayIso();
    const past = [];
    for (const event of events) {
        if (isPastEvent(event, today))
            past.push(event);
        else
            el.existingCards.appendChild(cardFor(event));
    }
    for (const event of past.reverse())
        el.pastCards.appendChild(cardFor(event));
    updateEventListState();
}
function updateEventListState() {
    const pastTotal = el.pastCards.children.length;
    el.existingEmpty.hidden = el.existingCards.children.length > 0;
    el.pastCount.textContent = String(pastTotal);
    el.pastEvents.hidden = pastTotal === 0;
}
// The date, plus the start (and end) time when the event has one.
function formatEventWhen(event) {
    const date = formatEventDate(event.date);
    if (!event.time)
        return date;
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
    renderEventLists(events, createSchoolEventCard);
}
// The same card also stands in for a school-sourced event in a class's own
// list (event.school_event), where it's flagged as coming from the school's
// calendar - and, if the sibling class has it too, as shared with the year.
function createSchoolEventCard(event) {
    const node = el.wholeSchoolCardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = event.id;
    find(node, ".field-description").value = event.description || "";
    find(node, ".field-location").value = event.location || "";
    const tags = [];
    if (event.school_event)
        tags.push({ text: "From school calendar" });
    if (event.correction)
        tags.push({ text: "Date corrected", warning: true });
    setSummary(node, event.title, formatSchoolSpan(event), tags);
    setupFolding(node);
    trackChanges(node);
    const group = currentYearGroup();
    if (event.school_event && event.year_group && group) {
        const note = find(node, ".ws-shared-note");
        note.textContent = `Shared with ${yearGroupDescription(group)} - changes apply to every class.`;
        note.hidden = false;
    }
    // What the server last had, to send back only the fields a rep actually
    // changed - saving a location alone must not also store the school's
    // current description as an override (which would then stop following
    // the school's own edits to it).
    const saved = { description: (event.description || "").trim(), location: event.location || "" };
    const saveButton = find(node, ".card-save-button");
    saveButton.addEventListener("click", () => handleUpdateWholeSchoolEvent(node, event.id, saveButton, saved));
    setupDateCorrection(node, event);
    addWeekdayHints(node);
    return node;
}
// --- Correcting a school event's date/time -----------------------------------
//
// For when the school's own calendar is wrong. It changes the event for every
// family subscribed to it, and for a closure day which days recurring class
// events skip, so it's kept out of the way (a closed <details>), explains what
// it does, needs a reason, and takes two clicks: the first spells out the
// change, the second makes it. See functions/api/_shared/schoolEventCorrections.ts.
// Same keywords as _CLOSURE_KEYWORDS in scripts/build_ics.py.
const CLOSURE_KEYWORDS = /\bINSET\b|\bHALF TERM\b|\bHOLIDAY\b/i;
function formatDayDate(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
// "Tue 27 Oct 2026 – Sat 31 Oct 2026", "Wed 7 Oct 2026, 14:30–15:30".
function formatSchoolSpan({ date = "", end_date, time, end_time }) {
    if (time)
        return `${formatDayDate(date)}, ${time}${end_time ? `–${end_time}` : ""}`;
    if (end_date && end_date !== date)
        return `${formatDayDate(date)} – ${formatDayDate(end_date)}`;
    return formatDayDate(date);
}
// Who a correction reaches, for the warning and the confirmation.
function correctionAudience(event) {
    if (state.calendar === WHOLE_SCHOOL.code)
        return "every family subscribed to the Whole School calendar";
    const group = currentYearGroup();
    if (event.year_group && group)
        return `every family subscribed to ${yearGroupDescription(group)}`;
    return `every family subscribed to ${calendarLabelFor(state.calendar)}`;
}
// The corrected {start, end} in the file's format, or an error to show.
function readCorrection(card, event) {
    const value = (cls) => find(card, cls).value;
    if (!event.time) {
        const start = value(".correction-start-date");
        const end = value(".correction-end-date") || start;
        if (!start)
            return { error: "Choose the first day." };
        if (end < start)
            return { error: "The last day can't be before the first day." };
        return { start, end, span: { date: start, end_date: end } };
    }
    const date = value(".correction-date");
    const time = value(".correction-time");
    const endTime = value(".correction-end-time");
    if (!date || !time || !endTime)
        return { error: "Choose the date, start time and end time." };
    if (endTime <= time)
        return { error: "The end time must be after the start time." };
    return { start: `${date}T${time}`, end: `${date}T${endTime}`, span: { date, end_date: date, time, end_time: endTime } };
}
function setupDateCorrection(card, event) {
    const section = find(card, ".date-correction");
    // Past events don't matter any more, and a timed event running over several
    // days has no same-day end time to correct (the server refuses both too).
    if (isPastEvent(event, todayIso()) || (event.time && !event.end_time))
        return;
    section.hidden = false;
    const school = event.correction ? event.correction.school : event;
    if (event.correction) {
        const was = school ? `Date corrected - the school's calendar says ${formatSchoolSpan(school)}.` : "Date corrected.";
        const why = event.correction.note ? ` Reason: ${event.correction.note}` : "";
        const corrected = find(card, ".ws-corrected");
        corrected.textContent = `${was}${why}`;
        corrected.hidden = false;
    }
    find(card, ".correction-audience").textContent = correctionAudience(event);
    find(card, ".correction-closure").hidden = !CLOSURE_KEYWORDS.test(event.title);
    find(card, ".correction-school").textContent = school
        ? `School's calendar says: ${formatSchoolSpan(school)}`
        : "";
    if (event.time) {
        find(card, ".correction-timed").hidden = false;
        find(card, ".correction-date").value = event.date;
        find(card, ".correction-time").value = event.time;
        find(card, ".correction-end-time").value = event.end_time ?? "";
        wireDefaultEndTime(find(card, ".correction-time"), find(card, ".correction-end-time"), {
            minutes: () => eventMinutes(event.time, event.end_time),
        });
    }
    else {
        find(card, ".correction-all-day").hidden = false;
        find(card, ".correction-start-date").value = event.date;
        find(card, ".correction-end-date").value = event.end_date || event.date;
    }
    const min = todayIso();
    for (const input of section.querySelectorAll('input[type="date"]'))
        input.min = min;
    const saveButton = find(card, ".correction-save-button");
    const undoButton = find(card, ".correction-undo-button");
    undoButton.hidden = !event.correction;
    // Any change after the first click takes the confirmation back - it no
    // longer describes what would be saved.
    section.addEventListener("input", () => disarmCorrection(card));
    saveButton.addEventListener("click", () => {
        const errorEl = find(card, ".correction-error");
        errorEl.hidden = true;
        const read = readCorrection(card, event);
        const note = find(card, ".correction-note").value.replace(/\s+/g, " ").trim();
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
function disarmCorrection(card) {
    find(card, ".correction-confirm").hidden = true;
    for (const button of card.querySelectorAll(".correction-save-button, .correction-undo-button")) {
        if (button.dataset.label)
            button.textContent = button.dataset.label;
        delete button.dataset.label;
        delete button.dataset.armed;
    }
}
// First click: say exactly what will change and arm the button. Second click
// on the same (still armed) button: save.
async function submitCorrection(card, event, button, message, armedLabel, correction) {
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
    const { ok, data } = await apiCall("/api/events-update", {
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
    const school = event.correction
        ? event.correction.school
        : { date: event.date, end_date: event.end_date, time: event.time, end_time: event.end_time };
    if (!school) {
        await reloadEventList();
        return;
    }
    const { correction: _old, ...base } = event;
    let updated = { ...base, ...school };
    if (correction) {
        const [date, time] = correction.start.split("T");
        const [endDate, endTime] = correction.end.split("T");
        const span = { date, end_date: endDate, time: time || null, end_time: endTime || null };
        const same = ["date", "end_date", "time", "end_time"].every((k) => (span[k] || null) === (school[k] || null));
        updated = same ? updated : { ...updated, ...span, correction: { note: correction.note, school } };
    }
    const fresh = createSchoolEventCard(updated);
    const status = find(fresh, ".correction-confirm");
    status.textContent = "Saved ✓ - the calendars update in a few minutes, and people's calendar apps pick it up on their next refresh.";
    status.hidden = false;
    find(fresh, ".date-correction").open = true;
    setCardOpen(fresh, true);
    card.replaceWith(fresh);
}
async function reloadEventList() {
    const { ok, data } = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
    if (!ok)
        return;
    if (state.calendar === WHOLE_SCHOOL.code)
        renderWholeSchoolEvents(data.events);
    else
        renderExistingEvents(data.events);
}
async function handleUpdateWholeSchoolEvent(card, id, button, saved) {
    const errorEl = find(card, ".field-error");
    errorEl.hidden = true;
    const description = find(card, ".field-description").value.trim();
    const location = find(card, ".field-location").value.replace(/\s+/g, " ").trim();
    const changes = {};
    if (description !== saved.description)
        changes.description = description;
    if (location !== saved.location)
        changes.location = location;
    const originalText = button.dataset.label || button.textContent;
    if (Object.keys(changes).length === 0) {
        setDirty(card, false);
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
    setDirty(card, false);
    button.textContent = "Saved ✓";
    setTimeout(() => {
        button.textContent = originalText;
    }, 2000);
}
function renderExistingEvents(events) {
    el.schoolEventsNotice.hidden = !events.some((e) => e.school_event);
    renderEventLists(events, (event) => (event.school_event ? createSchoolEventCard(event) : createExistingEventCard(event)));
}
function createExistingEventCard(event) {
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = event.id;
    if (event.year_group)
        node.dataset.shared = "1";
    fillCardFields(node, event);
    wireCardDefaultEndTime(node);
    wireRecurrenceToggle(node);
    wireExceptionsSection(node, event.exceptions, { shared: Boolean(event.year_group) });
    setupYearGroupControls(node, { saved: true, shared: Boolean(event.year_group) });
    addWeekdayHints(node);
    setManualSummary(node, readCardFields(node));
    setupFolding(node);
    trackChanges(node);
    const saveButton = find(node, ".card-save-button");
    saveButton.hidden = false;
    saveButton.addEventListener("click", () => handleUpdateExisting(node, event.id, saveButton));
    const removeButton = find(node, ".card-remove-button");
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => handleDeleteExisting(node, event.id, removeButton));
    return node;
}
async function handleUpdateExisting(card, id, button) {
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
    setDirty(card, false);
    setManualSummary(card, value);
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
