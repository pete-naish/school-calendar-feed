// The "What's on this week" WhatsApp list.
import { formatDate, relativeWeek, shiftIsoDate } from "./dates.js";
import { copyText, el } from "./dom.js";
import { apiCall, state, storageGet, storageSet } from "./state.js";
import { track } from "./track.js";
// Built each time its tab is opened (selectTab()), and by Refresh. No
// argument: this week (or next, on a Sunday - the server decides).
// `shiftDays` steps from the week already showing: -7/+7 for the arrows, 0 to
// build the same week again.
export async function handleWeekList(shiftDays) {
    el.weekListError.hidden = true;
    const buttons = [el.weekPrevButton, el.weekNextButton, el.weekRefreshButton];
    buttons.forEach((b) => (b.disabled = true));
    const body = {
        calendar: state.calendar,
        passcode: state.passcode,
        emoji: el.weekEmojiToggle.checked,
    };
    if (shiftDays !== undefined && state.weekStart)
        body.week_start = shiftIsoDate(state.weekStart, shiftDays);
    const { ok, data } = await apiCall("/api/week", body);
    buttons.forEach((b) => (b.disabled = false));
    el.weekListLoading.hidden = true;
    if (!ok) {
        el.weekListError.textContent = (data && (data.message || data.error)) || "Couldn't build the list - try again.";
        el.weekListError.hidden = false;
        return;
    }
    state.weekStart = data.week_start;
    const which = relativeWeek(data.week_start);
    const range = `${formatDate(data.week_start, { weekday: false })} – ${formatDate(data.week_end, { weekday: false })}`;
    el.weekListLabel.textContent = which ? `${which}: ${range}` : range;
    el.weekListOutput.value = data.text;
    el.weekCopyStatus.textContent = "";
    el.weekListPanel.hidden = false;
}
// "Add emoji": on unless this browser's rep turned it off. Changing it builds
// the same week again, with or without.
const EMOJI_KEY = "rep-tool-week-emoji";
export function wireWeekEmoji() {
    el.weekEmojiToggle.checked = storageGet(localStorage, EMOJI_KEY) !== "off";
    el.weekEmojiToggle.addEventListener("change", () => {
        storageSet(localStorage, EMOJI_KEY, el.weekEmojiToggle.checked ? null : "off");
        handleWeekList(0);
    });
}
export async function handleCopyWeekList() {
    const copied = await copyText(el.weekListOutput);
    if (copied)
        track("week_copy");
    el.weekCopyStatus.textContent = copied ? "Copied ✓ - paste it into WhatsApp." : "Couldn't copy - the text is selected, so press Ctrl/Cmd+C.";
}
