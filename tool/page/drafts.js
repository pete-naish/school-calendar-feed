// Adding events: pasting text for Claude to read events from, typing one in
// by hand, and saving the new ("draft") cards together.
import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic } from "../appHelpers.js";
import { addWeekdayHints } from "./cardState.js";
import { confirmSecondClick, el, find, plural } from "./dom.js";
import { fillCardFields, localValidationError, readCardFields, setupYearGroupControls, wireCardDefaultEndTime, wireRecurrenceToggle } from "./eventCard.js";
import { rebuildWait, renderExistingEvents, showListStatus } from "./eventList.js";
import { selectTab } from "./tabs.js";
import { apiCall, state } from "./state.js";
// "Find events" stays disabled until there's text it hasn't already been
// through (state.lastExtractedText), so a second press can't add every event
// twice. Changing the text clears what the last look found.
export function updateExtractButtonState() {
    const text = el.pasteTextarea.value.trim();
    el.extractButton.disabled = state.extracting || !text || text === state.lastExtractedText;
    if (!state.extracting && text !== state.lastExtractedText)
        el.extractStatus.textContent = "";
}
export async function handleExtract() {
    const text = el.pasteTextarea.value;
    if (!text.trim())
        return;
    el.extractError.hidden = true;
    state.extracting = true;
    updateExtractButtonState();
    el.extractStatus.textContent = "Reading that text…";
    const { ok, data } = await apiCall("/api/parse", { calendar: state.calendar, passcode: state.passcode, text });
    state.extracting = false;
    el.extractStatus.textContent = "";
    if (ok && data.events?.length)
        state.lastExtractedText = text.trim();
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
        addDraftCard(event, { fromText: true });
    }
    if (data.events?.length) {
        el.extractStatus.textContent = `Found ${plural(data.events.length, "event")} in this text. Change the text to look again.`;
    }
}
// "Save 3 events" - unless it's mid-save or asking "Save anyway".
function saveAllLabel() {
    return `Save ${plural(el.draftCards.children.length, "event")}`;
}
// The "Check before saving" heading and the save bar show while there are
// new events to save.
export function updateDraftControlsVisibility() {
    const count = el.draftCards.children.length;
    el.draftsHeading.hidden = count === 0;
    el.saveBar.hidden = count === 0;
    el.draftsCount.textContent = `${plural(count, "new event")} · nothing is published until you save`;
    el.saveBarText.textContent = `${plural(count, "new event")} ready to save`;
    if (!el.saveAllButton.disabled && !confirmPublicField(el.saveAllButton).confirm_public)
        el.saveAllButton.textContent = saveAllLabel();
}
// `fromText`: read from pasted text, so labelled that way - worth a closer look.
export function addDraftCard(event, { fromText = false } = {}) {
    const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
    fillCardFields(node, event);
    wireCardDefaultEndTime(node);
    wireRecurrenceToggle(node);
    setupYearGroupControls(node);
    addWeekdayHints(node);
    // Drafts save together from the save bar, so they have no buttons of their
    // own beyond removing one.
    find(node, ".card-draft-header").hidden = false;
    find(node, ".card-origin").textContent = fromText ? "New · read from your text" : "New";
    find(node, ".card-save-button").hidden = true;
    find(node, ".card-remove-button").hidden = true;
    // A blank card goes straight away; one with something in it (typed, or
    // read from pasted text) asks first.
    const removeButton = find(node, ".card-draft-remove");
    removeButton.addEventListener("click", () => {
        const { title, date } = readCardFields(node);
        if ((title || date) && !confirmSecondClick(removeButton, "Really remove?"))
            return;
        node.remove();
        updateDraftControlsVisibility();
    });
    el.draftCards.appendChild(node);
    updateDraftControlsVisibility();
}
export async function handleSaveAll() {
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
    el.saveAllButton.textContent = saveAllLabel();
    if (isConfirmPublic(resp)) {
        armPublicConfirm(el.saveAllButton, saveAllLabel(), el.saveError, resp.data.message, el.draftCards);
        return;
    }
    if (!ok) {
        el.saveError.textContent = (data && data.message) || "Couldn't save - try again.";
        el.saveError.hidden = false;
        return;
    }
    // Back to the list, where the new events will be, saying what happened.
    const skipped = data.skipped_duplicates ? ` (${plural(data.skipped_duplicates, "duplicate")} skipped)` : "";
    el.draftCards.innerHTML = "";
    el.pasteTextarea.value = "";
    updateExtractButtonState();
    updateDraftControlsVisibility();
    selectTab("events");
    showListStatus(`${plural(data.saved, "event")} saved${skipped}. ${data.saved === 1 ? "It'll" : "They'll"} appear in the calendar ${rebuildWait(data.rebuild_triggered)}.`);
    el.existingStatus.scrollIntoView({ block: "nearest" });
    const listResult = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
    if (listResult.ok)
        renderExistingEvents(listResult.data.events);
}
