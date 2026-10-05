// The signed-in page's four tabs: Events, Add events, What's on this week and
// Share. A standard tablist: Left/Right (and Home/End) move between the tabs
// shown, and only the selected one is in the Tab order. The open tab is kept
// for the browser tab, like the sign-in, so a refresh comes back to it.
import { el } from "./dom.js";
import { state, storageGet, storageSet } from "./state.js";
import { handleShare } from "./share.js";
import { handleWeekList } from "./weekList.js";
const TAB_KEY = "rep-tool-tab";
export function rememberedTab() {
    const tab = storageGet(sessionStorage, TAB_KEY);
    return tab === "events" || tab === "add" || tab === "week" || tab === "share" ? tab : null;
}
export function forgetTab() {
    storageSet(sessionStorage, TAB_KEY, null);
}
function tabs() {
    return [
        { name: "events", tab: el.tabEvents, panel: el.existingSection },
        { name: "add", tab: el.tabAdd, panel: el.addSection },
        { name: "week", tab: el.tabWeek, panel: el.weekSection },
        { name: "share", tab: el.tabShare, panel: el.shareSection },
    ];
}
export function selectTab(name, { focus = false } = {}) {
    for (const t of tabs()) {
        const selected = t.name === name;
        t.tab.setAttribute("aria-selected", String(selected));
        t.tab.tabIndex = selected ? 0 : -1;
        t.panel.hidden = !selected;
        if (selected && focus)
            t.tab.focus();
    }
    storageSet(sessionStorage, TAB_KEY, name);
    // The weekly list is built each time it's opened (the same week again, once
    // one is showing), so it picks up anything saved since.
    if (name === "week")
        handleWeekList(state.weekStart ? 0 : undefined);
    if (name === "share")
        handleShare();
}
export function wireTabs() {
    for (const t of tabs()) {
        t.tab.addEventListener("click", () => selectTab(t.name));
        t.tab.addEventListener("keydown", (e) => {
            const shown = tabs().filter((x) => !x.tab.hidden);
            const at = shown.findIndex((x) => x.name === t.name);
            const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: shown.length - 1 }[e.key];
            if (to === undefined)
                return;
            e.preventDefault();
            selectTab(shown[(to + shown.length) % shown.length].name, { focus: true });
        });
    }
}
