// Adding events: pasting text for Claude to read events from, typing one in
// by hand, and saving the new ("draft") cards together.
import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic } from "../appHelpers.js";
import { addWeekdayHints } from "./cardState.js";
import { formatSchoolSpan } from "./dates.js";
import { confirmSecondClick, el, find, plural } from "./dom.js";
import { fillCardFields, localValidationError, readCardFields, setupYearGroupControls, wireCardDefaultEndTime, wireRecurrenceToggle } from "./eventCard.js";
import { rebuildWait, renderExistingEvents, showListStatus } from "./eventList.js";
import { selectTab } from "./tabs.js";
import { apiCall, state } from "./state.js";
import type { DraftEvent } from "./state.js";
import type { AlreadyListed, ClassListedEvent, ListResponse, ParseResponse, SaveResponse } from "../functions/api/_shared/types.d.ts";

// "Find events" stays disabled until there's text it hasn't already been
// through (state.lastExtractedText), so a second press can't add every event
// twice. Changing the text clears what the last look found.
export function updateExtractButtonState() {
  const text = el.pasteTextarea.value.trim();
  el.extractButton.disabled = state.extracting || !text || text === state.lastExtractedText;
  if (!state.extracting && text !== state.lastExtractedText) el.extractStatus.textContent = "";
}

export async function handleExtract() {
  const text = el.pasteTextarea.value;
  if (!text.trim()) return;

  el.extractError.hidden = true;
  state.extracting = true;
  updateExtractButtonState();
  el.extractButton.textContent = "Finding events…";
  el.extractStatus.textContent = "This can take a few seconds.";

  const { ok, data } = await apiCall<ParseResponse>("/api/parse", { calendar: state.calendar, passcode: state.passcode, text });

  state.extracting = false;
  el.extractButton.textContent = "Find events";
  el.extractStatus.textContent = "";
  if (ok && data.events?.length) state.lastExtractedText = text.trim();
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
    addDraftCard(event, { fromText: true, alreadyListed: event.already_listed });
  }
  if (data.events?.length) {
    const found = data.events.length;
    const listed = data.events.filter((e) => e.already_listed).length;
    const already =
      listed === 0
        ? ""
        : listed === found
          ? `, ${found === 1 ? "but it's" : `but ${found === 2 ? "both" : "all"} are`} already in the calendar`
          : ` - ${listed} ${listed === 1 ? "is" : "are"} already in the calendar`;
    el.extractStatus.textContent = `Found ${plural(found, "event")} in this text${already}. Change the text to look again.`;
    // The new cards are below the paste box - off the screen on a phone - so
    // go to them.
    el.draftsHeading.focus({ preventScroll: true });
    el.draftsHeading.scrollIntoView({ block: "start" });
  }
}

// The draft cards that will be saved - not ones left out as already in the
// calendar.
function savableCards() {
  return [...el.draftCards.querySelectorAll<HTMLElement>(".event-card:not(.is-already-listed)")];
}

// "Save 3 events" - unless it's mid-save or asking "Save anyway".
function saveAllLabel() {
  return `Save ${plural(savableCards().length, "event")}`;
}

// The "Check before saving" heading shows while there are draft cards, and
// the save bar while any of them will be saved.
export function updateDraftControlsVisibility() {
  const count = savableCards().length;
  const listed = el.draftCards.children.length - count;
  el.draftsHeading.hidden = el.draftCards.children.length === 0;
  el.saveBar.hidden = count === 0;
  el.draftsCount.textContent = `${plural(count, "new event")} to check${listed ? `, ${listed} already in the calendar` : ""}`;
  if (!el.saveAllButton.disabled && !confirmPublicField(el.saveAllButton).confirm_public) el.saveAllButton.textContent = saveAllLabel();
}

// `fromText`: read from pasted text, so labelled that way - worth a closer look.
// `alreadyListed`: the event in the calendar it repeats, so it's left out (see
// markAlreadyListed).
export function addDraftCard(
  event: DraftEvent,
  { fromText = false, alreadyListed }: { fromText?: boolean; alreadyListed?: AlreadyListed } = {}
) {
  const node = el.cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  fillCardFields(node, event);
  wireCardDefaultEndTime(node);
  wireRecurrenceToggle(node);
  setupYearGroupControls(node);
  addWeekdayHints(node);
  // Drafts save together from the save bar, so they have no buttons of their
  // own beyond removing one.
  find(node, ".card-draft-header").hidden = false;
  find(node, ".card-origin").textContent = fromText ? "New · read from your text" : "New";
  find<HTMLButtonElement>(node, ".card-save-button").hidden = true;
  find<HTMLButtonElement>(node, ".card-remove-button").hidden = true;
  // A blank card goes straight away, as does one left out as already in the
  // calendar; one with something in it (typed, or read from pasted text) asks
  // first.
  const removeButton = find<HTMLButtonElement>(node, ".card-draft-remove");
  removeButton.addEventListener("click", () => {
    const { title, date } = readCardFields(node);
    const leftOut = node.classList.contains("is-already-listed");
    if (!leftOut && (title || date) && !confirmSecondClick(removeButton, "Really remove?")) return;
    node.remove();
    updateDraftControlsVisibility();
  });
  if (alreadyListed) markAlreadyListed(node, alreadyListed);
  el.draftCards.appendChild(node);
  updateDraftControlsVisibility();
}

// A card for an event the calendar already has (most often a whole-school one
// a class newsletter repeats - which a rep can't see from their class) is
// folded away, says what it repeats, and isn't saved unless "Add anyway".
function markAlreadyListed(node: HTMLElement, listed: AlreadyListed) {
  const origin = find(node, ".card-origin");
  const originText = origin.textContent;
  const body = find(node, ".card-body");
  node.classList.add("is-already-listed");
  origin.textContent = "Already in the calendar";
  origin.classList.add("badge-warning");
  body.hidden = true;

  const where = listed.source === "whole_school" ? "the Whole School calendar" : "this class's calendar";
  const note = document.createElement("p");
  note.className = "card-already-listed";
  note.append(`This looks like `);
  const title = document.createElement("strong");
  title.textContent = listed.title;
  note.append(title, ` (${formatSchoolSpan(listed)}), already in ${where} - so it won't be saved unless you add it anyway.`);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "secondary-button small-button card-add-anyway";
  addButton.textContent = "Add anyway";
  addButton.addEventListener("click", () => {
    node.classList.remove("is-already-listed");
    origin.textContent = originText;
    origin.classList.remove("badge-warning");
    note.remove();
    addButton.remove();
    body.hidden = false;
    updateDraftControlsVisibility();
    find<HTMLInputElement>(node, ".field-title").focus();
  });

  const header = find(node, ".card-draft-header");
  header.insertBefore(addButton, find(node, ".card-draft-remove"));
  header.after(note);
}

export async function handleSaveAll() {
  const cards = savableCards();
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
  // The save button just disappeared with the bar, so put the focus on what
  // happened (and its Undo) rather than leave it nowhere.
  el.existingStatus.focus({ preventScroll: true });
  el.existingStatus.scrollIntoView({ block: "nearest" });

  const listResult = await apiCall<ListResponse>("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (listResult.ok) renderExistingEvents(listResult.data.events as ClassListedEvent[]);
}
