// What the page knows about each event card, and the parts every card has:
// the folded summary, the unsaved-changes marking, the status line, weekday
// hints under date boxes and default end times.
import { find } from "./dom.js";
import { addMinutes, DEFAULT_MINUTES, formatShortWeekday, formatWeekday } from "./dates.js";
import type { CardValue } from "./state.js";
import type { EventException } from "../functions/api/_shared/types.d.ts";

// A card's state, kept here rather than in data-* attributes on the card.
export interface CardState {
  // A saved event's id and first day (for keeping the list in date order);
  // unset on a draft.
  id?: string;
  date?: string;
  // "rep" for an event added here, "school" for one from the school's own
  // calendar - for the list's "Show" filter.
  kind?: "rep" | "school";
  // Shared by the whole year group (a class calendar's year-wide event).
  shared: boolean;
  // Edited since it was last saved (see setDirty()).
  dirty: boolean;
  // The exceptions as edited, saved with the event (see exceptions.ts).
  exceptions: EventException[];
  // A saved rep event as it was last saved, for undoing a delete.
  saved?: CardValue;
}

const cards = new WeakMap<HTMLElement, CardState>();

// The card's state, made empty on first use.
export function cardState(card: HTMLElement): CardState {
  let s = cards.get(card);
  if (!s) {
    s = { shared: false, dirty: false, exceptions: [] };
    cards.set(card, s);
  }
  return s;
}

// --- Folded saved events ----------------------------------------------------
//
// A saved event's card starts folded to a summary (a date tile, the title,
// when, badges) so a long list can be scanned; clicking the summary opens the
// form. Draft cards have no summary and are always open.

export function isCardOpen(card: HTMLElement) {
  return find(card, ".card-summary").getAttribute("aria-expanded") === "true";
}

export function setCardOpen(card: HTMLElement, open: boolean) {
  find(card, ".card-summary").setAttribute("aria-expanded", String(open));
  find(card, ".card-body").hidden = !open;
}

export function setupFolding(card: HTMLElement) {
  const summary = find<HTMLButtonElement>(card, ".card-summary");
  summary.hidden = false;
  summary.addEventListener("click", () => setCardOpen(card, !isCardOpen(card)));
  setCardOpen(card, false);
}

export function setSummary(
  card: HTMLElement,
  { title, date, when, tags }: { title: string; date: string; when: string; tags: { text: string; warning?: boolean }[] }
) {
  find(card, ".date-tile-weekday").textContent = date ? formatShortWeekday(date) : "";
  find(card, ".date-tile-day").textContent = date ? String(Number(date.slice(8))) : "?";
  find(card, ".card-summary-title").textContent = title || "(No title)";
  find(card, ".card-summary-when").textContent = when;
  const container = find(card, ".card-summary-tags");
  container.innerHTML = "";
  for (const tag of tags) {
    const badge = document.createElement("span");
    badge.className = tag.warning ? "badge badge-warning" : "badge";
    badge.textContent = tag.text;
    container.append(badge);
  }
}

// --- Unsaved changes --------------------------------------------------------
//
// A saved event's card is marked once a rep edits it, until it's saved: it
// says so (in the summary too, so it shows while folded), it survives the
// list reloading after another save, and switching calendar or leaving the
// page asks first. Typing in the exception or date-correction forms doesn't
// count - neither changes the event until it's added or saved itself.

export function setDirty(card: HTMLElement, dirty: boolean) {
  cardState(card).dirty = dirty;
  find(card, ".card-summary-unsaved").hidden = !dirty;
  find(card, ".card-unsaved").hidden = !dirty;
  if (dirty) showCardStatus(card, "");
  const exceptionsNote = card.querySelector<HTMLElement>(".exceptions-unsaved");
  if (exceptionsNote && !dirty) exceptionsNote.hidden = true;
}

export function trackChanges(card: HTMLElement) {
  const onEdit = (e: Event) => {
    if ((e.target as Element).closest(".exception-add-form, .date-correction")) return;
    setDirty(card, true);
  };
  card.addEventListener("input", onEdit);
  card.addEventListener("change", onEdit);
}

// The line by a card's buttons saying what its last save did. Cleared by the
// next edit (setDirty()).
export function showCardStatus(card: HTMLElement, text: string) {
  find(card, ".card-status").textContent = text;
}

// --- Weekdays under date boxes ----------------------------------------------
//
// A date box shows 09/10/2026 but not that it's a Friday, which is how a date
// that's a day out (easy when "next Thursday" was read from pasted text)
// gets spotted.

export function addWeekdayHints(root: HTMLElement) {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="date"]')) {
    const hint = document.createElement("span");
    hint.className = "weekday hint";
    input.after(hint);
  }
  root.addEventListener("input", () => refreshWeekdayHints(root));
  refreshWeekdayHints(root);
}

// Also needed after setting a date box's value from code, which fires no event.
export function refreshWeekdayHints(root: HTMLElement) {
  for (const hint of root.querySelectorAll<HTMLElement>(".weekday")) {
    const input = hint.previousElementSibling as HTMLInputElement;
    hint.textContent = input.value ? formatWeekday(input.value) : "";
  }
}

// --- Default end times ------------------------------------------------------

// Fills `endInput` `minutes()` after `startInput` now, and keeps it there as
// the start changes - until the rep sets a different end time, which is left
// alone. `skip()` says when there's no such default to show (a multi-day
// event with no end time runs to the end of its last day instead).
export function wireDefaultEndTime(
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
