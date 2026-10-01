// The list of a calendar's saved events: upcoming, then the folded "Past
// events", with search and filter, kept in date order as events change.
import { isPastEvent } from "../appHelpers.js";
import { cardState, isCardOpen, setCardOpen } from "./cardState.js";
import { todayIso } from "./dates.js";
import { el, find } from "./dom.js";
import { createExistingEventCard } from "./eventCard.js";
import { createSchoolEventCard } from "./schoolCard.js";
import { apiCall, state, WHOLE_SCHOOL } from "./state.js";
export function renderWholeSchoolEvents(events) {
    el.schoolEventsNotice.hidden = true;
    renderEventLists(events, createSchoolEventCard);
}
export function renderExistingEvents(events) {
    el.schoolEventsNotice.hidden = !events.some((e) => e.school_event);
    renderEventLists(events, (event) => (event.school_event ? createSchoolEventCard(event) : createExistingEventCard(event)));
}
export async function reloadEventList() {
    const { ok, data } = await apiCall("/api/events-list", { calendar: state.calendar, passcode: state.passcode });
    if (!ok)
        return;
    if (state.calendar === WHOLE_SCHOOL.code)
        renderWholeSchoolEvents(data.events);
    else
        renderExistingEvents(data.events);
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
    for (const card of allEventCards()) {
        const { id } = cardState(card);
        if (id)
            previous.set(id, card);
    }
    const cardFor = (event) => {
        const old = previous.get(event.id);
        if (old && cardState(old).dirty)
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
    applyEventFilters();
}
// After a save changes an event's dates: moves its card to where the list
// would have put it - upcoming in date order, or past newest first.
export function placeCard(card, event) {
    cardState(card).date = event.date;
    const past = isPastEvent(event, todayIso());
    const list = past ? el.pastCards : el.existingCards;
    const before = [...list.children].find((c) => {
        const date = cardState(c).date ?? "";
        return c !== card && (past ? date < event.date : date > event.date);
    });
    const focused = document.activeElement;
    list.insertBefore(card, before ?? null);
    if (past)
        el.pastEvents.open = true;
    // Moving it drops the focus (on its save button, say) - put that back.
    if (focused instanceof HTMLElement && card.contains(focused))
        focused.focus();
    card.scrollIntoView({ block: "nearest" });
    applyEventFilters();
}
// --- Search and filter ----------------------------------------------------------
//
// A search box over the list (title, location, description - including
// unsaved edits) once there are enough events to need one, and an "Added here"
// / "From school calendar" choice when a class's list has both.
const FILTER_FROM = 6;
export function allEventCards() {
    return [...el.existingCards.children, ...el.pastCards.children];
}
function cardMatchesFilters(card) {
    const query = el.eventSearch.value.trim().toLowerCase();
    const kind = el.eventKind.value;
    if (kind && cardState(card).kind !== kind)
        return false;
    if (!query)
        return true;
    const text = [
        find(card, ".card-summary-title").textContent,
        find(card, ".field-location").value,
        find(card, ".field-description").value,
    ].join(" ");
    return text.toLowerCase().includes(query);
}
export function applyEventFilters() {
    for (const card of allEventCards())
        card.hidden = !cardMatchesFilters(card);
    updateEventListState();
}
export function updateEventListState() {
    const shown = (list) => [...list.children].filter((c) => !c.hidden).length;
    const filtering = Boolean(el.eventSearch.value.trim() || el.eventKind.value);
    const pastShown = shown(el.pastCards);
    el.existingEmpty.textContent = filtering ? "No upcoming events match." : "No upcoming events.";
    el.existingEmpty.hidden = shown(el.existingCards) > 0;
    el.pastCount.textContent = String(pastShown);
    el.pastEvents.hidden = pastShown === 0;
    const cards = allEventCards();
    el.eventFilters.hidden = cards.length < FILTER_FROM && !filtering;
    const kinds = new Set(cards.map((c) => cardState(c).kind));
    el.eventKindLabel.hidden = !(kinds.has("school") && kinds.has("rep")) && !el.eventKind.value;
}
// The line above the list for what happened to an event no longer on it.
export function showListStatus(text, offerUndo = false) {
    el.existingStatusText.textContent = text;
    el.undoDeleteButton.hidden = !offerUndo;
    el.existingStatus.hidden = false;
}
// How soon a saved change reaches the published calendars (see
// triggerRebuild() in _shared/github.ts).
export function rebuildWait(rebuildTriggered) {
    return rebuildTriggered ? "within a few minutes" : "within 6 hours";
}
