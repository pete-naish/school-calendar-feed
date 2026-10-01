// The "What's on this week" WhatsApp list.
import { formatEventDate, relativeWeek, shiftIsoDate } from "./dates.js";
import { el } from "./dom.js";
import { apiCall, state } from "./state.js";
import type { WeekResponse } from "../functions/api/_shared/types.d.ts";

// Built when its tab is first opened (selectTab()). No argument: this week
// (or next, on a Sunday - the server decides). `shiftDays` (-7/+7) steps from
// the week already showing.
export async function handleWeekList(shiftDays?: number) {
  el.weekListError.hidden = true;
  const buttons = [el.weekPrevButton, el.weekNextButton];
  buttons.forEach((b) => (b.disabled = true));

  const body: { calendar: string | null; passcode: string | null; week_start?: string } = {
    calendar: state.calendar,
    passcode: state.passcode,
  };
  if (shiftDays && state.weekStart) body.week_start = shiftIsoDate(state.weekStart, shiftDays);
  const { ok, data } = await apiCall<WeekResponse>("/api/week", body);

  buttons.forEach((b) => (b.disabled = false));
  el.weekListLoading.hidden = true;
  if (!ok) {
    el.weekListError.textContent = (data && (data.message || data.error)) || "Couldn't build the list - try again.";
    el.weekListError.hidden = false;
    return;
  }
  state.weekStart = data.week_start;
  const which = relativeWeek(data.week_start);
  el.weekListLabel.textContent = `${which ? `${which}: ` : ""}${formatEventDate(data.week_start)} – ${formatEventDate(data.week_end)}`;
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
  } catch {
    // Clipboard API unavailable or blocked (e.g. plain http) - fall back to
    // selecting the text and the legacy copy command.
    el.weekListOutput.select();
    copied = document.execCommand("copy");
  }
  el.weekCopyStatus.textContent = copied ? "Copied ✓ - paste it into WhatsApp." : "Couldn't copy - the text is selected, so press Ctrl/Cmd+C.";
}
