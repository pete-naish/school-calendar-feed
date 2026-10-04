// The page's own elements and small DOM helpers shared by every part of it.
// The element `selector` finds inside `root`. The page's templates always
// have it, so a miss is a bug - which throws on first use, as it always has.
export function find(root, selector) {
    return root.querySelector(selector);
}
// The page's own elements - always there, since index.html and this ship together.
function byId(id) {
    return document.getElementById(id);
}
export const el = {
    siteHeader: byId("site-header"),
    calendarSelect: byId("calendar-select"),
    usernameInput: byId("username-input"),
    passcodeInput: byId("passcode-input"),
    loginButton: byId("login-button"),
    loginError: byId("login-error"),
    loginSection: byId("login-section"),
    appSection: byId("app-section"),
    activeCalendarName: byId("active-calendar-name"),
    calendarGroupLabel: byId("calendar-group-label"),
    calendarCounts: byId("calendar-counts"),
    tabEvents: byId("tab-events"),
    tabAdd: byId("tab-add"),
    tabWeek: byId("tab-week"),
    existingSection: byId("existing-section"),
    weekSection: byId("week-section"),
    logoutButton: byId("logout-button"),
    wholeSchoolNotice: byId("whole-school-notice"),
    addSection: byId("add-section"),
    wholeSchoolCardTemplate: byId("whole-school-event-template"),
    pasteTextarea: byId("paste-textarea"),
    extractButton: byId("extract-button"),
    extractError: byId("extract-error"),
    extractStatus: byId("extract-status"),
    draftCards: byId("draft-cards"),
    addManualCardButton: byId("add-manual-card-button"),
    draftsHeading: byId("drafts-heading"),
    draftsCount: byId("drafts-count"),
    saveBar: byId("save-bar"),
    saveAllButton: byId("save-all-button"),
    saveError: byId("save-error"),
    eventFilters: byId("event-filters"),
    eventSearch: byId("event-search"),
    eventKind: byId("event-kind"),
    existingStatus: byId("existing-status"),
    existingStatusText: byId("existing-status-text"),
    undoDeleteButton: byId("undo-delete-button"),
    existingLoading: byId("existing-loading"),
    existingEmpty: byId("existing-empty"),
    existingCards: byId("existing-cards"),
    pastEvents: byId("past-events"),
    pastCount: byId("past-count"),
    pastCards: byId("past-cards"),
    schoolEventsNotice: byId("school-events-notice"),
    schoolNoticeDismiss: byId("school-notice-dismiss"),
    cardTemplate: byId("event-card-template"),
    weekListError: byId("week-list-error"),
    weekListLoading: byId("week-list-loading"),
    weekListPanel: byId("week-list-panel"),
    weekListLabel: byId("week-list-label"),
    weekListOutput: byId("week-list-output"),
    weekPrevButton: byId("week-prev-button"),
    weekNextButton: byId("week-next-button"),
    weekRefreshButton: byId("week-refresh-button"),
    weekCopyButton: byId("week-copy-button"),
    weekCopyStatus: byId("week-copy-status"),
};
// Two clicks for something that loses work: the first relabels `button` with
// `question` (in red) and returns false; a second click within 8 seconds -
// long enough to read the question on a phone - returns true. Otherwise the
// button goes back to how it was. A button that's asking is in `asking`,
// with its own label and the timer that puts it back.
const asking = new WeakMap();
export function confirmSecondClick(button, question) {
    if (asking.has(button)) {
        resetConfirm(button);
        return true;
    }
    asking.set(button, { label: button.textContent ?? "", timer: setTimeout(() => resetConfirm(button), 8000) });
    button.classList.add("confirm");
    button.textContent = question;
    return false;
}
export function resetConfirm(button) {
    const ask = asking.get(button);
    if (!ask)
        return;
    clearTimeout(ask.timer);
    asking.delete(button);
    button.textContent = ask.label;
    button.classList.remove("confirm");
}
export function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
