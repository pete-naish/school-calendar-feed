// The signed-in page's three tabs: Events, Add events, and What's on this
// week. A standard tablist: Left/Right (and Home/End) move between the tabs
// shown, and only the selected one is in the Tab order.
import { el } from "./dom.js";
import { state } from "./state.js";
import { handleWeekList } from "./weekList.js";
function tabs() {
    return [
        { name: "events", tab: el.tabEvents, panel: el.existingSection },
        { name: "add", tab: el.tabAdd, panel: el.addSection },
        { name: "week", tab: el.tabWeek, panel: el.weekSection },
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
    // The weekly list is built when it's first wanted, not at sign-in.
    if (name === "week" && !state.weekStart)
        handleWeekList();
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
