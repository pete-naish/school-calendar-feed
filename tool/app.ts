// The class rep tool's page: wires the page's controls to the code in page/,
// one module per part of the page:
//
//   login.ts       choosing a calendar, signing in, staying signed in, switching
//   drafts.ts      pasting text to extract events, adding events by hand, Save all
//   eventList.ts   the saved events list: order, Past events, search and filter
//   eventCard.ts   a rep's own saved event: fields, save, delete and undo
//   exceptions.ts  a repeating event's moved or cancelled occurrences
//   schoolCard.ts  an event from the school's calendar, and correcting its date
//   cardState.ts   per-card state and the parts every card shares
//   weekList.ts    "What's on this week"
//   share.ts       "Share": the parents' link, message, QR code and click count
//   tabs.ts        the Events / Add events / What's on this week / Share tabs
//   track.ts       counting what reps do, for the weekly usage counts
//   state.ts, dom.ts, dates.ts   shared state, elements and date helpers
//
// Loading a page/ module only defines things (and looks up the page's
// elements, in dom.ts) - only init() below calls into them - so the modules
// can import each other freely.
import { el } from "./page/dom.js";
import { addDraftCard, handleExtract, handleSaveAll, updateExtractButtonState } from "./page/drafts.js";
import { blankEvent, handleUndoDelete } from "./page/eventCard.js";
import { wireEventFilters, wireSchoolNotice } from "./page/eventList.js";
import { handleLogin, handleLogout, hasUnsavedWork, loadCalendars, restoreSession, updateLoginButtonState } from "./page/login.js";
import { state } from "./page/state.js";
import { wireShare } from "./page/share.js";
import { wireTabs } from "./page/tabs.js";
import { track } from "./page/track.js";
import { handleCopyWeekList, handleWeekList, wireWeekEmoji } from "./page/weekList.js";

function init() {
  loadCalendars().then(restoreSession);
  el.calendarSelect.addEventListener("change", updateLoginButtonState);
  el.passcodeInput.addEventListener("input", updateLoginButtonState);
  el.passcodeInput.addEventListener("keydown", (e) => {
    // Same guard as the button: no calendar picked yet (or a login already
    // in flight) leaves it disabled, and Enter must respect that too.
    if (e.key === "Enter" && !el.loginButton.disabled) handleLogin();
  });
  el.loginButton.addEventListener("click", handleLogin);
  el.logoutButton.addEventListener("click", handleLogout);
  el.extractButton.addEventListener("click", handleExtract);
  el.pasteTextarea.addEventListener("input", updateExtractButtonState);
  updateExtractButtonState();
  el.addManualCardButton.addEventListener("click", () => {
    track("manual_add");
    addDraftCard(blankEvent());
  });
  el.saveAllButton.addEventListener("click", handleSaveAll);
  wireTabs();
  el.weekPrevButton.addEventListener("click", () => handleWeekList(-7));
  el.weekNextButton.addEventListener("click", () => handleWeekList(7));
  el.weekRefreshButton.addEventListener("click", () => handleWeekList(0));
  el.weekCopyButton.addEventListener("click", handleCopyWeekList);
  wireWeekEmoji();
  wireShare();
  wireEventFilters();
  wireSchoolNotice();
  el.undoDeleteButton.addEventListener("click", handleUndoDelete);
  window.addEventListener("beforeunload", (e) => {
    if (state.calendar && hasUnsavedWork()) e.preventDefault();
  });
}

init();
