// The "What's on this week" WhatsApp list.
import { formatDate, relativeWeek, shiftIsoDate } from "./dates.js";
import { el } from "./dom.js";
import { apiCall, state } from "./state.js";
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
export async function handleCopyWeekList() {
    const text = el.weekListOutput.value;
    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    }
    catch {
        // Clipboard API unavailable or blocked (e.g. plain http) - fall back to
        // selecting the text and the legacy copy command.
        el.weekListOutput.select();
        copied = document.execCommand("copy");
    }
    el.weekCopyStatus.textContent = copied ? "Copied ✓ - paste it into WhatsApp." : "Couldn't copy - the text is selected, so press Ctrl/Cmd+C.";
}
