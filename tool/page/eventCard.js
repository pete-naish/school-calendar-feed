// A rep's own event on a card: the form's fields, checking them, and saving,
// deleting (and undoing a delete of) an event that's already saved. Draft
// cards for new events use the same form - see drafts.ts.
import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic, isOccurrence } from "../appHelpers.js";
import { addWeekdayHints, cardState, refreshWeekdayHints, setDirty, setSummary, setupFolding, showCardStatus, trackChanges, wireDefaultEndTime, } from "./cardState.js";
import { daysInclusive, endsBeforeStart, formatDate, shiftIsoDate, todayIso } from "./dates.js";
import { confirmSecondClick, el, find, plural } from "./dom.js";
import { listDate, placeCard, rebuildWait, reloadEventList, showListStatus, updateEventListState } from "./eventList.js";
import { getCardExceptions, wireExceptionsSection } from "./exceptions.js";
import { setupEventShare, watchSaved } from "./eventShare.js";
import { eventPageKey } from "../appHelpers.js";
import { POSTER_BUSY_MESSAGE, posterBusy, posterKey, setupPosterField } from "./poster.js";
import { apiCall, currentYearGroup, state, yearGroupDescription } from "./state.js";
const RECURRENCE_OPTIONS = {
    daily: { freq: "DAILY", interval: 1 },
    weekly: { freq: "WEEKLY", interval: 1 },
    fortnightly: { freq: "WEEKLY", interval: 2 },
    monthly: { freq: "MONTHLY", interval: 1 },
};
const RECURRENCE_LABELS = {
    daily: "Daily",
    weekly: "Weekly",
    fortnightly: "Every 2 weeks",
    monthly: "Monthly",
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
export function blankEvent() {
    return { title: "", date: "", end_date: null, time: null, end_time: null, description: null, location: null, url: null, recurrence: null };
}
// A multi-day event with a start time could be those times on each day, or
// one stretch from the first day's start to the last day's end - the card
// asks which (see wireEachDay()).
function eachDayApplies(value) {
    return Boolean(value.end_date && value.end_date > value.date && value.time && !value.recurrence);
}
export function localValidationError(value) {
    if (!value.title || !value.date)
        return "Title and date are required.";
    if (value.end_date && value.end_date < value.date)
        return "End date can't be before the start date.";
    if (eachDayApplies(value) && typeof value.each_day !== "boolean") {
        return "Say whether it's on at those times each day, or runs straight through from the first day to the last.";
    }
    if ((!value.end_date || value.end_date === value.date || value.each_day) && endsBeforeStart(value.time, value.end_time)) {
        return "The end time must be after the start time.";
    }
    if (value.recurrence && !value.recurrence.until)
        return "Repeat until date is required for a repeating event.";
    const recurrence = value.recurrence;
    const stray = recurrence && value.exceptions.find((exc) => !isOccurrence(exc.date, value.date, recurrence));
    if (stray) {
        return `The exception on ${formatDate(stray.date)} isn't a day this event repeats on any more - remove it, or change the event back.`;
    }
    return null;
}
// A new event on a class calendar can be ticked as "all of Year 1", saving it
// once for every class in the year. An already-saved event can't switch
// scope here: a shared one shows a note instead of the tick box (editing or
// deleting it changes it for the whole year), and a class-only one shows
// neither.
export function setupYearGroupControls(card, { saved = false, shared = false } = {}) {
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
export function wireCardDefaultEndTime(card) {
    const date = find(card, ".field-date");
    const endDate = find(card, ".field-end-date");
    wireDefaultEndTime(find(card, ".field-time"), find(card, ".field-end-time"), {
        skip: () => Boolean(endDate.value && endDate.value !== date.value),
    });
}
export function fillCardFields(card, event) {
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
    find(card, ".field-each-day").value = event.each_day === true ? "each" : event.each_day === false ? "through" : "";
    setupPosterField(card, event.image);
}
// The card's answer to wireEachDay()'s question: true (each day), false
// (straight through), null (not answered yet) - or nothing, when it doesn't apply.
function eachDayField(card) {
    if (find(card, ".field-each-day-label").hidden)
        return {};
    const answer = find(card, ".field-each-day").value;
    return { each_day: answer === "each" ? true : answer === "through" ? false : null };
}
// Shows the each-day question when the card's an event over several days
// with a start time and no repeat, its answers spelt out with the card's own
// days and times ("19:00–22:00 on each day", "One stretch, Tue 8 Dec 19:00 to
// Wed 9 Dec 22:00").
export function wireEachDay(card) {
    const label = find(card, ".field-each-day-label");
    const select = find(card, ".field-each-day");
    const sync = () => {
        const date = find(card, ".field-date").value;
        const endDate = find(card, ".field-end-date").value || null;
        const time = find(card, ".field-time").value || null;
        const endTime = find(card, ".field-end-time").value || null;
        const recurrence = find(card, ".field-recurrence").value || null;
        label.hidden = !eachDayApplies({ date, end_date: endDate, time, recurrence });
        if (label.hidden)
            return;
        const times = `${time}${endTime ? `–${endTime}` : ""}`;
        select.options[1].textContent = `On each day, ${times}`;
        select.options[2].textContent = `One stretch, ${formatDate(date)} ${time} to ${formatDate(endDate)}${endTime ? ` ${endTime}` : ""}`;
    };
    card.addEventListener("input", sync);
    card.addEventListener("change", sync);
    sync();
}
export function readCardFields(card) {
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
        image: posterKey(card),
        ...eachDayField(card),
        year_group: find(card, ".field-year-group").checked,
        recurrence,
        exceptions: [...getCardExceptions(card)],
    };
}
// "Repeat until" when a rep picks a repeat by hand: the end of the term the
// event starts in, as an extracted repeat gets (see termEnd.ts), or about 12
// weeks on if the term dates aren't known. Just a suggestion - it's editable.
function suggestRepeatUntil(start) {
    const termEnd = state.termEnds.find((date) => date >= start);
    return termEnd ?? shiftIsoDate(start, 84);
}
// Shows the "Repeat until" field only once a repeat frequency is picked,
// filling in a suggestion when it's empty.
export function wireRecurrenceToggle(card) {
    const select = find(card, ".field-recurrence");
    const untilLabel = find(card, ".field-recurrence-until-label");
    const untilInput = find(card, ".field-recurrence-until");
    const sync = () => {
        untilLabel.hidden = !select.value;
    };
    select.addEventListener("change", () => {
        if (select.value && !untilInput.value) {
            untilInput.value = suggestRepeatUntil(find(card, ".field-date").value || todayIso());
            refreshWeekdayHints(card);
        }
        sync();
    });
    sync();
}
// The line under a saved event's title - the date tile beside it has the day:
// "09:00–10:00 · Weekly until Thu 17 Dec · Hall", "Mon 2 Nov – Wed 4 Nov · 3 days".
function manualEventWhen(event) {
    const parts = [];
    if (event.end_date && event.end_date !== event.date) {
        parts.push(`${formatDate(event.date)} – ${formatDate(event.end_date)}`, `${daysInclusive(event.date, event.end_date)} days`);
        if (event.time && event.each_day)
            parts.push(`${event.time}${event.end_time ? `–${event.end_time}` : ""} each day`);
        else if (event.time)
            parts.push(`from ${event.time}`);
    }
    else {
        parts.push(event.time ? `${event.time}${event.end_time ? `–${event.end_time}` : ""}` : "All day");
    }
    const repeat = RECURRENCE_LABELS[recurrenceToSelectValue(event.recurrence)];
    if (repeat)
        parts.push(`${repeat}${event.recurrence?.until ? ` until ${formatDate(event.recurrence.until)}` : ""}`);
    if (event.location)
        parts.push(event.location);
    return parts.join(" · ");
}
// While exceptions are being added or removed (not yet saved), the summary
// counts the ones on the card - alongside its "Unsaved changes" badge - rather
// than the saved ones, so it agrees with the list below it.
export function showEditedExceptions(card) {
    const saved = cardState(card).saved;
    if (saved)
        setManualSummary(card, { ...saved, exceptions: getCardExceptions(card) });
}
function setManualSummary(card, event) {
    const group = currentYearGroup();
    const tags = [];
    if (cardState(card).shared && group)
        tags.push({ text: `All of ${group.label}` });
    if (event.recurrence && event.exceptions.length)
        tags.push({ text: plural(event.exceptions.length, "exception") });
    setSummary(card, { title: event.title, date: listDate(event), when: manualEventWhen(event), tags });
}
export function createExistingEventCard(event) {
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    const card = cardState(node);
    card.id = event.id;
    card.date = listDate(event);
    card.kind = "rep";
    card.shared = Boolean(event.year_group);
    card.rev = event.rev;
    fillCardFields(node, event);
    wireCardDefaultEndTime(node);
    wireRecurrenceToggle(node);
    wireEachDay(node);
    // Saved before the question existed (or answered "straight through"):
    // that's how it's been published.
    const eachDay = find(node, ".field-each-day");
    if (!find(node, ".field-each-day-label").hidden && !eachDay.value)
        eachDay.value = "through";
    wireExceptionsSection(node, event.exceptions, { shared: card.shared });
    setupYearGroupControls(node, { saved: true, shared: card.shared });
    addWeekdayHints(node);
    card.saved = { ...readCardFields(node), year_group: card.shared };
    setManualSummary(node, readCardFields(node));
    setupFolding(node);
    trackChanges(node);
    const saveButton = find(node, ".card-save-button");
    saveButton.hidden = false;
    saveButton.addEventListener("click", () => handleUpdateExisting(node, event.id, saveButton));
    setupEventShare(node, () => {
        const saved = cardState(node).saved;
        const repeat = RECURRENCE_LABELS[recurrenceToSelectValue(saved.recurrence)];
        return {
            key: eventPageKey(event.id, false),
            title: saved.title,
            // A repeating event's next day, as its date tile shows.
            date: cardState(node).date ?? saved.date,
            end_date: saved.recurrence ? null : saved.end_date,
            each_day: saved.each_day === true,
            time: saved.time,
            end_time: saved.end_time,
            location: saved.location,
            repeats: repeat ? repeat.toLowerCase() : null,
            image: saved.image,
            rev: cardState(node).rev,
        };
    });
    const removeButton = find(node, ".card-remove-button");
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => handleDeleteExisting(node, event.id, removeButton));
    return node;
}
async function handleUpdateExisting(card, id, button) {
    const errorEl = find(card, ".field-error");
    const value = readCardFields(card);
    const error = posterBusy(card) ? POSTER_BUSY_MESSAGE : localValidationError(value);
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
    button.textContent = originalText;
    if (!ok) {
        errorEl.textContent = (data && data.message) || "Couldn't save changes - try again.";
        errorEl.hidden = false;
        return;
    }
    cardState(card).saved = { ...value, year_group: cardState(card).shared };
    cardState(card).rev = data.rev;
    setDirty(card, false);
    setManualSummary(card, value);
    if (data.rebuild_triggered)
        watchSaved(card);
    else
        showCardStatus(card, `Saved ✓ - calendars update ${rebuildWait(false)}.`);
    placeCard(card, value);
}
async function handleDeleteExisting(card, id, button) {
    if (!confirmSecondClick(button, "Really delete?"))
        return;
    button.disabled = true;
    button.textContent = "Deleting…";
    const { ok, data } = await apiCall("/api/events-delete", { calendar: state.calendar, passcode: state.passcode, id });
    if (!ok) {
        const errorEl = find(card, ".field-error");
        errorEl.textContent = (data && data.message) || "Couldn't delete - try again.";
        errorEl.hidden = false;
        button.disabled = false;
        button.textContent = "Delete";
        return;
    }
    state.lastDeleted = cardState(card).saved ?? null;
    const title = state.lastDeleted?.title || "the event";
    card.remove();
    updateEventListState();
    showListStatus(`Deleted "${title}" - it'll be gone from calendars ${rebuildWait(data.rebuild_triggered)}.`, Boolean(state.lastDeleted));
}
// Puts a deleted event back by saving it again, as it was last saved - for
// every class of the year if it was shared. It gets a new id, so to calendar
// apps it's a new event. The rep already confirmed any contact details in it.
export async function handleUndoDelete() {
    const event = state.lastDeleted;
    if (!event)
        return;
    el.undoDeleteButton.disabled = true;
    const { ok, data } = await apiCall("/api/save", {
        calendar: state.calendar,
        passcode: state.passcode,
        events: [event],
        confirm_public: true,
    });
    el.undoDeleteButton.disabled = false;
    if (!ok) {
        showListStatus((data && data.message) || "Couldn't put it back - try again.", true);
        return;
    }
    state.lastDeleted = null;
    showListStatus(`Put "${event.title}" back - calendars update ${rebuildWait(data.rebuild_triggered)}.`);
    await reloadEventList();
}
