// What the page knows about each event card, and the parts every card has:
// the folded summary, the unsaved-changes marking, the status line, weekday
// hints under date boxes and default end times.
import { find } from "./dom.js";
import { addMinutes, DEFAULT_MINUTES, formatShortWeekday, formatWeekday } from "./dates.js";
const cards = new WeakMap();
// The card's state, made empty on first use.
export function cardState(card) {
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
export function isCardOpen(card) {
    return find(card, ".card-summary").getAttribute("aria-expanded") === "true";
}
export function setCardOpen(card, open) {
    find(card, ".card-summary").setAttribute("aria-expanded", String(open));
    find(card, ".card-body").hidden = !open;
}
export function setupFolding(card) {
    const summary = find(card, ".card-summary");
    summary.hidden = false;
    summary.addEventListener("click", () => setCardOpen(card, !isCardOpen(card)));
    setCardOpen(card, false);
}
export function setSummary(card, { title, date, when, tags }) {
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
export function setDirty(card, dirty) {
    cardState(card).dirty = dirty;
    find(card, ".card-summary-unsaved").hidden = !dirty;
    find(card, ".card-unsaved").hidden = !dirty;
    if (dirty)
        showCardStatus(card, "");
    const exceptionsNote = card.querySelector(".exceptions-unsaved");
    if (exceptionsNote && !dirty)
        exceptionsNote.hidden = true;
}
export function trackChanges(card) {
    const onEdit = (e) => {
        if (e.target.closest(".exception-add-form, .date-correction"))
            return;
        setDirty(card, true);
    };
    card.addEventListener("input", onEdit);
    card.addEventListener("change", onEdit);
}
// The line by a card's buttons saying what its last save did. Cleared by the
// next edit (setDirty()).
export function showCardStatus(card, text) {
    find(card, ".card-status").textContent = text;
}
// --- Weekdays under date boxes ----------------------------------------------
//
// A date box shows 09/10/2026 but not that it's a Friday, which is how a date
// that's a day out (easy when "next Thursday" was read from pasted text)
// gets spotted.
export function addWeekdayHints(root) {
    for (const input of root.querySelectorAll('input[type="date"]')) {
        const hint = document.createElement("span");
        hint.className = "weekday hint";
        input.after(hint);
    }
    root.addEventListener("input", () => refreshWeekdayHints(root));
    refreshWeekdayHints(root);
}
// Also needed after setting a date box's value from code, which fires no event.
export function refreshWeekdayHints(root) {
    for (const hint of root.querySelectorAll(".weekday")) {
        const input = hint.previousElementSibling;
        hint.textContent = input.value ? formatWeekday(input.value) : "";
    }
}
// --- Default end times ------------------------------------------------------
// Fills `endInput` `minutes()` after `startInput` now, and keeps it there as
// the start changes - until the rep sets a different end time, which is left
// alone. `skip()` says when there's no such default to show (a multi-day
// event with no end time runs to the end of its last day instead).
export function wireDefaultEndTime(startInput, endInput, { minutes = () => DEFAULT_MINUTES, skip = () => false } = {}) {
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
