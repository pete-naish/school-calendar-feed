// A rep's own event on a card: the form's fields, checking them, and saving,
// deleting (and undoing a delete of) an event that's already saved. Draft
// cards for new events use the same form - see drafts.ts.
import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic, isOccurrence } from "../appHelpers.js";
import {
  addWeekdayHints,
  cardState,
  refreshWeekdayHints,
  setDirty,
  setSummary,
  setupFolding,
  showCardStatus,
  trackChanges,
  wireDefaultEndTime,
} from "./cardState.js";
import { endsBeforeStart, formatDayDate, shiftIsoDate, todayIso } from "./dates.js";
import { confirmSecondClick, el, find } from "./dom.js";
import type { Field } from "./dom.js";
import { placeCard, rebuildWait, reloadEventList, showListStatus, updateEventListState } from "./eventList.js";
import { getCardExceptions, wireExceptionsSection } from "./exceptions.js";
import { apiCall, currentYearGroup, state, yearGroupDescription } from "./state.js";
import type { CardRecurrence, CardValue, DraftEvent } from "./state.js";
import type {
  ClassListedEvent,
  DeleteResponse,
  Recurrence,
  RecurrenceFreq,
  SaveResponse,
  UpdateResponse,
} from "../functions/api/_shared/types.d.ts";

const RECURRENCE_OPTIONS: Record<string, { freq: RecurrenceFreq; interval: number }> = {
  daily: { freq: "DAILY", interval: 1 },
  weekly: { freq: "WEEKLY", interval: 1 },
  fortnightly: { freq: "WEEKLY", interval: 2 },
  monthly: { freq: "MONTHLY", interval: 1 },
};

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Every 2 weeks",
  monthly: "Monthly",
};

function recurrenceToSelectValue(recurrence: CardRecurrence | Recurrence | null | undefined) {
  if (!recurrence) return "";
  if (recurrence.freq === "DAILY") return "daily";
  if (recurrence.freq === "WEEKLY" && recurrence.interval === 2) return "fortnightly";
  if (recurrence.freq === "WEEKLY") return "weekly";
  if (recurrence.freq === "MONTHLY") return "monthly";
  return ""; // an interval/freq combination the picker can't represent - treated as non-recurring here
}

export function blankEvent(): DraftEvent {
  return { title: "", date: "", end_date: null, time: null, end_time: null, description: null, location: null, url: null, recurrence: null };
}

export function localValidationError(value: CardValue) {
  if (!value.title || !value.date) return "Title and date are required.";
  if (value.end_date && value.end_date < value.date) return "End date can't be before the start date.";
  if ((!value.end_date || value.end_date === value.date) && endsBeforeStart(value.time, value.end_time)) {
    return "The end time must be after the start time.";
  }
  if (value.recurrence && !value.recurrence.until) return "Repeat until date is required for a repeating event.";
  const recurrence = value.recurrence as Recurrence | null;
  const stray = recurrence && value.exceptions.find((exc) => !isOccurrence(exc.date, value.date, recurrence));
  if (stray) {
    return `The exception on ${formatDayDate(stray.date)} isn't a day this event repeats on any more - remove it, or change the event back.`;
  }
  return null;
}

// A new event on a class calendar can be ticked as "all of Year 1", saving it
// once for every class in the year. An already-saved event can't switch
// scope here: a shared one shows a note instead of the tick box (editing or
// deleting it changes it for the whole year), and a class-only one shows
// neither.
export function setupYearGroupControls(card: HTMLElement, { saved = false, shared = false } = {}) {
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

export function wireCardDefaultEndTime(card: HTMLElement) {
  const date = find<HTMLInputElement>(card, ".field-date");
  const endDate = find<HTMLInputElement>(card, ".field-end-date");
  wireDefaultEndTime(find<HTMLInputElement>(card, ".field-time"), find<HTMLInputElement>(card, ".field-end-time"), {
    skip: () => Boolean(endDate.value && endDate.value !== date.value),
  });
}

export function fillCardFields(card: HTMLElement, event: DraftEvent) {
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

export function readCardFields(card: HTMLElement): CardValue {
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
    exceptions: [...getCardExceptions(card)],
  };
}

// "Repeat until" when a rep picks a repeat by hand: the end of the term the
// event starts in, as an extracted repeat gets (see termEnd.ts), or about 12
// weeks on if the term dates aren't known. Just a suggestion - it's editable.
function suggestRepeatUntil(start: string) {
  const termEnd = state.termEnds.find((date) => date >= start);
  return termEnd ?? shiftIsoDate(start, 84);
}

// Shows the "Repeat until" field only once a repeat frequency is picked,
// filling in a suggestion when it's empty.
export function wireRecurrenceToggle(card: HTMLElement) {
  const select = find<HTMLSelectElement>(card, ".field-recurrence");
  const untilLabel = find(card, ".field-recurrence-until-label");
  const untilInput = find<HTMLInputElement>(card, ".field-recurrence-until");
  const sync = () => {
    untilLabel.hidden = !select.value;
  };
  select.addEventListener("change", () => {
    if (select.value && !untilInput.value) {
      untilInput.value = suggestRepeatUntil(find<Field>(card, ".field-date").value || todayIso());
      refreshWeekdayHints(card);
    }
    sync();
  });
  sync();
}

// "Thu 9 Oct 2026, 15:30–16:30 · Weekly until Thu 17 Dec 2026 · 1 exception"
function manualEventWhen(event: Omit<CardValue, "year_group">) {
  let when = event.date ? formatDayDate(event.date) : "No date";
  if (event.end_date && event.end_date !== event.date) when += ` – ${formatDayDate(event.end_date)}`;
  if (event.time) when += `, ${event.time}${event.end_time ? `–${event.end_time}` : ""}`;
  const repeat = RECURRENCE_LABELS[recurrenceToSelectValue(event.recurrence)];
  if (repeat) when += ` · ${repeat}${event.recurrence?.until ? ` until ${formatDayDate(event.recurrence.until)}` : ""}`;
  const exceptions = event.exceptions?.length ?? 0;
  if (exceptions) when += ` · ${exceptions} exception${exceptions === 1 ? "" : "s"}`;
  return when;
}

function setManualSummary(card: HTMLElement, event: Omit<CardValue, "year_group">) {
  const group = currentYearGroup();
  const tags = cardState(card).shared && group ? [{ text: `All of ${group.label}` }] : [];
  setSummary(card, event.title, manualEventWhen(event), tags);
}

export function createExistingEventCard(event: ClassListedEvent & { school_event?: undefined }) {
  const node = el.cardTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
  const card = cardState(node);
  card.id = event.id;
  card.date = event.date;
  card.kind = "rep";
  card.shared = Boolean(event.year_group);
  fillCardFields(node, event);
  wireCardDefaultEndTime(node);
  wireRecurrenceToggle(node);
  wireExceptionsSection(node, event.exceptions, { shared: card.shared });
  setupYearGroupControls(node, { saved: true, shared: card.shared });
  addWeekdayHints(node);
  card.saved = { ...readCardFields(node), year_group: card.shared };
  setManualSummary(node, readCardFields(node));
  setupFolding(node);
  trackChanges(node);

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
  button.textContent = originalText;
  if (!ok) {
    errorEl.textContent = (data && data.message) || "Couldn't save changes - try again.";
    errorEl.hidden = false;
    return;
  }
  cardState(card).saved = { ...value, year_group: cardState(card).shared };
  setDirty(card, false);
  setManualSummary(card, value);
  showCardStatus(card, `Saved ✓ - calendars update ${rebuildWait(data.rebuild_triggered)}.`);
  placeCard(card, value);
}

async function handleDeleteExisting(card: HTMLElement, id: string, button: HTMLButtonElement) {
  if (!confirmSecondClick(button, "Really delete?")) return;

  button.disabled = true;
  button.textContent = "Deleting…";
  const { ok, data } = await apiCall<DeleteResponse>("/api/events-delete", { calendar: state.calendar, passcode: state.passcode, id });

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
  if (!event) return;
  el.undoDeleteButton.disabled = true;
  const { ok, data } = await apiCall<SaveResponse>("/api/save", {
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
