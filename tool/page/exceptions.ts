// A saved repeating event's exceptions: moving or cancelling single
// occurrences, optionally for just one class of a year-wide event.
//
// Only offered on an already-saved recurring event (createExistingEventCard),
// never on a draft card - there's no series to override yet. The working list
// is the card's state (cardState().exceptions), saved with the rest of the
// event through the normal "Save changes" -> /api/events-update path, with no
// separate endpoint.
import { isOccurrence } from "../appHelpers.js";
import { cardState, refreshWeekdayHints, setDirty, wireDefaultEndTime } from "./cardState.js";
import { endsBeforeStart, eventMinutes, formatDayDate } from "./dates.js";
import { find } from "./dom.js";
import type { Field } from "./dom.js";
import { readCardFields } from "./eventCard.js";
import { currentYearGroup, sortedClasses } from "./state.js";
import type { EventException } from "../functions/api/_shared/types.d.ts";

export function getCardExceptions(card: HTMLElement): EventException[] {
  return cardState(card).exceptions;
}

// A rep adding or removing one; nothing is stored until "Save changes".
function setCardExceptions(card: HTMLElement, exceptions: EventException[]) {
  cardState(card).exceptions = exceptions;
  renderExceptionsList(card);
  setDirty(card, true);
  find(card, ".exceptions-unsaved").hidden = false;
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
  const fmt = formatDayDate;
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
export function wireExceptionsSection(card: HTMLElement, initialExceptions: EventException[] | undefined, { shared = false } = {}) {
  cardState(card).exceptions = [...(initialExceptions || [])];
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

  // The occurrence picker only offers the series' own days where it can: from
  // the first to the last, in steps of a week (or two, or a day) - browsers that
  // honour `step` grey out the rest. A monthly series can't be put as a step.
  const syncOccurrenceLimits = () => {
    const { date, recurrence } = readCardFields(card);
    dateInput.min = date;
    dateInput.max = recurrence?.until ?? "";
    const step = recurrence && recurrence.freq !== "MONTHLY" ? (recurrence.freq === "WEEKLY" ? 7 : 1) * recurrence.interval : null;
    if (step) dateInput.step = String(step);
    else dateInput.removeAttribute("step");
  };
  for (const cls of [".field-date", ".field-recurrence", ".field-recurrence-until"]) {
    find(card, cls).addEventListener("change", syncOccurrenceLimits);
  }
  syncOccurrenceLimits();

  find(card, ".exception-add-button").addEventListener("click", () => {
    const errorEl = find(card, ".field-error");
    errorEl.hidden = true;
    const refuse = (message: string) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    };
    if (!dateInput.value) return refuse("Choose the date of the occurrence to change.");
    const { date: start, recurrence } = readCardFields(card);
    if (recurrence?.until && !isOccurrence(dateInput.value, start, { ...recurrence, until: recurrence.until })) {
      return refuse(`This event doesn't happen on ${formatDayDate(dateInput.value)} - choose one of the days it repeats on.`);
    }
    // Built up field by field; the select only offers "cancelled" and "moved".
    const exception = { date: dateInput.value, action: actionSelect.value } as EventException & {
      new_date?: string;
      new_time?: string | null;
      new_end_time?: string | null;
    };
    if (!scopeRow.hidden && scopeSelect.value) exception.classes = [scopeSelect.value];
    if (exception.action === "moved") {
      if (!newDateInput.value) return refuse("Choose the date to move it to.");
      exception.new_date = newDateInput.value;
      exception.new_time = newTimeInput.value || null;
      exception.new_end_time = newEndTimeInput.value || null;
      // With no new start it keeps the event's own times (see validate.ts).
      const start = exception.new_time || find<Field>(card, ".field-time").value || null;
      const end = exception.new_time ? exception.new_end_time : exception.new_end_time || find<Field>(card, ".field-end-time").value || null;
      if (endsBeforeStart(start, end)) return refuse("The new end time must be after the start time.");
    }
    const clash = getCardExceptions(card).find((e) => e.date === exception.date && exceptionScopesClash(e, exception));
    if (clash) return refuse(`There's already an exception on that date${exceptionScopeText(clash)} - remove it first to change it.`);
    setCardExceptions(card, [...getCardExceptions(card), exception]);
    dateInput.value = "";
    newDateInput.value = "";
    newTimeInput.value = "";
    newEndTimeInput.value = "";
    refreshWeekdayHints(card);
  });
}
