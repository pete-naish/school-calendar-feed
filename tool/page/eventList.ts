// The list of a calendar's saved events: upcoming, then the folded "Past
// events", with search and filter, kept in date order as events change.
import { isPastEvent, nextOccurrence } from "../appHelpers.js";
import type { Dated } from "../appHelpers.js";
import { cardState, isCardOpen, setCardOpen } from "./cardState.js";
import { formatMonthYear, todayIso } from "./dates.js";
import { el, find, plural } from "./dom.js";
import type { Field } from "./dom.js";
import { createExistingEventCard } from "./eventCard.js";
import { createSchoolEventCard } from "./schoolCard.js";
import { apiCall, state, storageGet, storageSet, WHOLE_SCHOOL } from "./state.js";
import type { ClassListedEvent, ListResponse, SchoolEvent } from "../functions/api/_shared/types.d.ts";

export function renderWholeSchoolEvents(events: SchoolEvent[]) {
  el.schoolEventsNotice.hidden = true;
  renderEventLists(events, createSchoolEventCard);
}

// The note explaining "From school calendar" events, until a rep says "Got it"
// - remembered in this browser, so it isn't at the top of every visit.
const SCHOOL_NOTICE_KEY = "rep-tool-school-notice-seen";

export function wireSchoolNotice() {
  el.schoolNoticeDismiss.addEventListener("click", () => {
    storageSet(localStorage, SCHOOL_NOTICE_KEY, "1");
    el.schoolEventsNotice.hidden = true;
  });
}

export function renderExistingEvents(events: ClassListedEvent[]) {
  el.schoolEventsNotice.hidden = !events.some((e) => e.school_event) || storageGet(localStorage, SCHOOL_NOTICE_KEY) === "1";
  renderEventLists(events, (event) => (event.school_event ? createSchoolEventCard(event) : createExistingEventCard(event)));
}

export async function reloadEventList() {
  const { ok, data } = await apiCall<ListResponse>("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
  if (!ok) return;
  if (state.calendar === WHOLE_SCHOOL.code) renderWholeSchoolEvents(data.events as SchoolEvent[]);
  else renderExistingEvents(data.events as ClassListedEvent[]);
}

// The day an event is listed under, and its date tile shows: a repeating
// event's next day (nextOccurrence() in appHelpers.ts), else its first.
export function listDate(event: Parameters<typeof nextOccurrence>[0]) {
  return nextOccurrence(event, todayIso(), state.calendar);
}

// Upcoming events in date order, then past ones newest first in the folded
// "Past events" section, so the list a rep lands on doesn't fill up with
// last term's events.
//
// On a reload (after saving new events, say) a card with unsaved edits is
// kept as it is rather than replaced, so the edits aren't lost, and a card
// that was open stays open.
function renderEventLists<E extends Dated & { id: string }>(events: E[], makeCard: (event: E) => HTMLElement) {
  const previous = new Map<string, HTMLElement>();
  for (const card of allEventCards()) {
    const { id } = cardState(card);
    if (id) previous.set(id, card);
  }
  const cardFor = (event: E) => {
    const old = previous.get(event.id);
    if (old && cardState(old).dirty) return old;
    const card = makeCard(event);
    if (old && isCardOpen(old)) setCardOpen(card, true);
    return card;
  };

  el.existingLoading.hidden = true;
  el.existingCards.innerHTML = "";
  el.pastCards.innerHTML = "";
  const today = todayIso();
  const past = [];
  const upcoming = [];
  for (const event of events) {
    if (isPastEvent(event, today)) past.push(event);
    else upcoming.push({ event, date: listDate(event) });
  }
  // The server lists by first day; a repeating event goes by its next one.
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const { event } of upcoming) el.existingCards.appendChild(cardFor(event));
  for (const event of past.reverse()) el.pastCards.appendChild(cardFor(event));
  applyEventFilters();
}

// After a save changes an event's dates: moves its card to where the list
// would have put it - upcoming in date order, or past newest first.
export function placeCard(card: HTMLElement, event: Parameters<typeof nextOccurrence>[0]) {
  const at = listDate(event);
  cardState(card).date = at;
  const past = isPastEvent(event, todayIso());
  const list = past ? el.pastCards : el.existingCards;
  const before = cardsIn(list).find((c) => {
    const date = cardState(c).date ?? "";
    return c !== card && (past ? date < at : date > at);
  });
  const focused = document.activeElement;
  list.insertBefore(card, before ?? null);
  if (past) el.pastEvents.open = true;
  // Moving it drops the focus (on its save button, say) - put that back.
  if (focused instanceof HTMLElement && card.contains(focused)) focused.focus();
  card.scrollIntoView({ block: "nearest" });
  applyEventFilters();
}

// The event cards in a list - which also holds its month headings.
function cardsIn(list: HTMLElement) {
  return [...list.querySelectorAll<HTMLElement>(":scope > .event-card")];
}

export function allEventCards() {
  return [...cardsIn(el.existingCards), ...cardsIn(el.pastCards)];
}

// A heading above the first card shown in each month ("October 2026"),
// redone whenever the list or the filters change.
function renderMonthHeadings(list: HTMLElement) {
  for (const heading of list.querySelectorAll(":scope > .month-heading")) heading.remove();
  let month = "";
  for (const card of cardsIn(list)) {
    const date = cardState(card).date;
    if (card.hidden || !date || date.slice(0, 7) === month) continue;
    month = date.slice(0, 7);
    const heading = document.createElement("h2");
    heading.className = "month-heading";
    heading.textContent = formatMonthYear(date);
    card.before(heading);
  }
}

// --- Search and filter ----------------------------------------------------------
//
// A search box over the list (title, location, description - including
// unsaved edits) once there are enough events to need one, and an "Added
// here" / "From school" choice when a class's list has both.

const FILTER_FROM = 6;

// The "Show" choice: "" for everything, else a card kind ("rep", "school").
let kindFilter = "";

export function wireEventFilters() {
  el.eventSearch.addEventListener("input", applyEventFilters);
  for (const button of el.eventKind.querySelectorAll("button")) {
    button.addEventListener("click", () => setKindFilter(button.value));
  }
}

function setKindFilter(kind: string) {
  kindFilter = kind;
  for (const button of el.eventKind.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.value === kind));
  }
  applyEventFilters();
}

// Back to everything, for the next calendar signed in to.
export function resetEventFilters() {
  el.eventSearch.value = "";
  setKindFilter("");
}

function cardMatchesFilters(card: HTMLElement) {
  const query = el.eventSearch.value.trim().toLowerCase();
  if (kindFilter && cardState(card).kind !== kindFilter) return false;
  if (!query) return true;
  const text = [
    find(card, ".card-summary-title").textContent,
    find<Field>(card, ".field-location").value,
    find<Field>(card, ".field-description").value,
  ].join(" ");
  return text.toLowerCase().includes(query);
}

export function applyEventFilters() {
  for (const card of allEventCards()) card.hidden = !cardMatchesFilters(card);
  updateEventListState();
}

export function updateEventListState() {
  const shown = (list: HTMLElement) => cardsIn(list).filter((c) => !c.hidden).length;
  const filtering = Boolean(el.eventSearch.value.trim() || kindFilter);
  const pastShown = shown(el.pastCards);
  el.existingEmpty.textContent = filtering ? "No upcoming events match." : "No upcoming events.";
  el.existingEmpty.hidden = shown(el.existingCards) > 0;
  el.pastCount.textContent = String(pastShown);
  el.pastEvents.hidden = pastShown === 0;
  renderMonthHeadings(el.existingCards);
  renderMonthHeadings(el.pastCards);

  const upcoming = cardsIn(el.existingCards).length;
  const past = cardsIn(el.pastCards).length;
  el.calendarCounts.textContent = `${plural(upcoming, "upcoming event")}${past ? ` · ${past} past` : ""}`;

  const cards = allEventCards();
  el.eventFilters.hidden = cards.length < FILTER_FROM && !filtering;
  const kinds = new Set(cards.map((c) => cardState(c).kind));
  el.eventKind.hidden = !(kinds.has("school") && kinds.has("rep")) && !kindFilter;
}

// The line above the list for what happened to an event no longer on it.
export function showListStatus(text: string, offerUndo = false) {
  el.existingStatusText.textContent = text;
  el.undoDeleteButton.hidden = !offerUndo;
  el.existingStatus.hidden = false;
}

// How soon a saved change reaches the published calendars (see
// triggerRebuild() in _shared/github.ts).
export function rebuildWait(rebuildTriggered: boolean) {
  return rebuildTriggered ? "within a few minutes" : "within 6 hours";
}
