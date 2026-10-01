// An event from the school's own calendar on a card. Its title and dates are
// the school's, so a rep can only add a description and location - and,
// tucked away, correct its date or time when the school's calendar is wrong.
import { armPublicConfirm, confirmPublicField, disarmPublicConfirm, isConfirmPublic, isPastEvent } from "../appHelpers.js";
import { addWeekdayHints, cardState, setCardOpen, setDirty, setSummary, setupFolding, showCardStatus, trackChanges, wireDefaultEndTime } from "./cardState.js";
import { daysInclusive, eventMinutes, formatDate, formatSchoolSpan, todayIso } from "./dates.js";
import { el, find } from "./dom.js";
import { placeCard, rebuildWait, reloadEventList } from "./eventList.js";
import { apiCall, calendarLabelFor, currentYearGroup, state, WHOLE_SCHOOL, yearGroupDescription } from "./state.js";
// Whole School events aren't stored/edited like a normal manual event -
// title/date/recurrence/etc all come from the school's own feed (dates can
// only be corrected, through the date-correction section below), so this is
// a much simpler read-mostly card (see
// #whole-school-event-template) instead of the full event-card-template
// used everywhere else, with only description + location fields and one
// save button.
//
// The same card also stands in for a school-sourced event in a class's own
// list (event.school_event), where it's flagged as coming from the school's
// calendar - and, if the sibling class has it too, as shared with the year.
export function createSchoolEventCard(event) {
    const node = el.wholeSchoolCardTemplate.content.firstElementChild.cloneNode(true);
    const card = cardState(node);
    card.id = event.id;
    card.date = event.date;
    card.kind = "school";
    find(node, ".field-description").value = event.description || "";
    find(node, ".field-location").value = event.location || "";
    const tags = [];
    if (event.school_event)
        tags.push({ text: "From school calendar" });
    if (event.correction)
        tags.push({ text: "Date corrected", warning: true });
    setSummary(node, { title: event.title, date: event.date, when: schoolEventWhen(event), tags });
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
// The line under a school event's title (the date tile has the day):
// "09:00–10:00 · Hall", "All day", "Mon 26 Oct – Fri 30 Oct · 5 days".
function schoolEventWhen(event) {
    const parts = [];
    if (event.time)
        parts.push(`${event.time}${event.end_time ? `–${event.end_time}` : ""}`);
    else if (event.end_date && event.end_date !== event.date) {
        parts.push(`${formatDate(event.date)} – ${formatDate(event.end_date)}`, `${daysInclusive(event.date, event.end_date)} days`);
    }
    else
        parts.push("All day");
    if (event.location)
        parts.push(event.location);
    return parts.join(" · ");
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
        showCardStatus(card, "Nothing to save - no changes.");
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
    button.textContent = originalText;
    showCardStatus(card, `Saved ✓ - calendars update ${rebuildWait(data.rebuild_triggered)}.`);
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
// The save or undo button that's had its first click, with its own label to
// go back to. Any edit to the section, or using the other button, takes that
// back (disarmCorrection()).
const armedLabels = new WeakMap();
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
        const label = armedLabels.get(button);
        if (label !== undefined)
            button.textContent = label;
        armedLabels.delete(button);
    }
}
// First click: say exactly what will change and arm the button. Second click
// on the same (still armed) button: save.
async function submitCorrection(card, event, button, message, armedLabel, correction) {
    const confirmEl = find(card, ".correction-confirm");
    const errorEl = find(card, ".correction-error");
    if (!armedLabels.has(button)) {
        disarmCorrection(card);
        confirmEl.textContent = message;
        confirmEl.hidden = false;
        armedLabels.set(button, button.textContent ?? "");
        button.textContent = armedLabel;
        return;
    }
    const label = armedLabels.get(button);
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
    status.textContent = `Saved ✓ - the calendars update ${rebuildWait(data.rebuild_triggered)}, and people's calendar apps pick it up on their next refresh.`;
    status.hidden = false;
    find(fresh, ".date-correction").open = true;
    setCardOpen(fresh, true);
    card.replaceWith(fresh);
    placeCard(fresh, updated);
}
