// The page's own elements and small DOM helpers shared by every part of it.

// The element `selector` finds inside `root`. The page's templates always
// have it, so a miss is a bug - which throws on first use, as it always has.
export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector(selector) as T;
}

// Anything with a .value.
export type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// The page's own elements - always there, since index.html and this ship together.
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export const el = {
  siteHeader: byId("site-header"),
  calendarSelect: byId<HTMLSelectElement>("calendar-select"),
  usernameInput: byId<HTMLInputElement>("username-input"),
  passcodeInput: byId<HTMLInputElement>("passcode-input"),
  loginButton: byId<HTMLButtonElement>("login-button"),
  loginError: byId("login-error"),
  loginSection: byId("login-section"),
  appSection: byId("app-section"),
  activeCalendarName: byId("active-calendar-name"),
  calendarGroupLabel: byId("calendar-group-label"),
  calendarCounts: byId("calendar-counts"),
  tabEvents: byId<HTMLButtonElement>("tab-events"),
  tabAdd: byId<HTMLButtonElement>("tab-add"),
  tabWeek: byId<HTMLButtonElement>("tab-week"),
  existingSection: byId("existing-section"),
  weekSection: byId("week-section"),
  switchCalendarButton: byId<HTMLButtonElement>("switch-calendar-button"),
  wholeSchoolNotice: byId("whole-school-notice"),
  addSection: byId("add-section"),
  wholeSchoolCardTemplate: byId<HTMLTemplateElement>("whole-school-event-template"),
  pasteTextarea: byId<HTMLTextAreaElement>("paste-textarea"),
  extractButton: byId<HTMLButtonElement>("extract-button"),
  extractError: byId("extract-error"),
  extractStatus: byId("extract-status"),
  draftCards: byId("draft-cards"),
  addManualCardButton: byId<HTMLButtonElement>("add-manual-card-button"),
  draftsHeading: byId("drafts-heading"),
  draftsCount: byId("drafts-count"),
  saveBar: byId("save-bar"),
  saveAllButton: byId<HTMLButtonElement>("save-all-button"),
  saveError: byId("save-error"),
  eventFilters: byId("event-filters"),
  eventSearch: byId<HTMLInputElement>("event-search"),
  eventKind: byId("event-kind"),
  existingStatus: byId("existing-status"),
  existingStatusText: byId("existing-status-text"),
  undoDeleteButton: byId<HTMLButtonElement>("undo-delete-button"),
  existingLoading: byId("existing-loading"),
  existingEmpty: byId("existing-empty"),
  existingCards: byId("existing-cards"),
  pastEvents: byId<HTMLDetailsElement>("past-events"),
  pastCount: byId("past-count"),
  pastCards: byId("past-cards"),
  schoolEventsNotice: byId("school-events-notice"),
  schoolNoticeDismiss: byId<HTMLButtonElement>("school-notice-dismiss"),
  cardTemplate: byId<HTMLTemplateElement>("event-card-template"),
  weekListError: byId("week-list-error"),
  weekListLoading: byId("week-list-loading"),
  weekListPanel: byId("week-list-panel"),
  weekListLabel: byId("week-list-label"),
  weekListOutput: byId<HTMLTextAreaElement>("week-list-output"),
  weekPrevButton: byId<HTMLButtonElement>("week-prev-button"),
  weekNextButton: byId<HTMLButtonElement>("week-next-button"),
  weekRefreshButton: byId<HTMLButtonElement>("week-refresh-button"),
  weekCopyButton: byId<HTMLButtonElement>("week-copy-button"),
  weekCopyStatus: byId("week-copy-status"),
};

// Two clicks for something that loses work: the first relabels `button` with
// `question` (in red) and returns false; a second click within 8 seconds -
// long enough to read the question on a phone - returns true. Otherwise the
// button goes back to how it was. A button that's asking is in `asking`,
// with its own label and the timer that puts it back.
const asking = new WeakMap<HTMLButtonElement, { label: string; timer: ReturnType<typeof setTimeout> }>();

export function confirmSecondClick(button: HTMLButtonElement, question: string) {
  if (asking.has(button)) {
    resetConfirm(button);
    return true;
  }
  asking.set(button, { label: button.textContent ?? "", timer: setTimeout(() => resetConfirm(button), 8000) });
  button.classList.add("confirm");
  button.textContent = question;
  return false;
}

export function resetConfirm(button: HTMLButtonElement) {
  const ask = asking.get(button);
  if (!ask) return;
  clearTimeout(ask.timer);
  asking.delete(button);
  button.textContent = ask.label;
  button.classList.remove("confirm");
}

export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
