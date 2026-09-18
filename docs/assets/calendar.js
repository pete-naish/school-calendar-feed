import ICAL from "https://cdn.jsdelivr.net/npm/ical.js@2.2.1/dist/ical.min.js";

// Mirrors YEAR_GROUPS in scripts/build_ics.py (and the two JS copies in
// tool/functions/api/_shared/calendars.js and tool/app.js) - keep all four
// in sync by hand (scripts/check_config_sync.py checks the 14 class
// codes/labels actually match on every push - see .github/workflows/test.yml).
// `dot` here maps to the categorical palette in calendar.css
// (validated via the dataviz skill's scripts/validate_palette.js): one hue
// per year group + FOSPS, "Whole School" is a neutral grey rather than a 9th
// generated hue since it's structurally the "everyone" bucket, not a peer
// category.
const GROUPS = [
  { label: "Reception", dot: "dot-reception", colorVar: "--cal-1", classes: [{ code: "rr", label: "RR" }, { code: "rgp", label: "RGP" }] },
  { label: "Year 1", dot: "dot-year1", colorVar: "--cal-2", classes: [{ code: "1ms", label: "1MS" }, { code: "1t", label: "1T" }] },
  { label: "Year 2", dot: "dot-year2", colorVar: "--cal-3", classes: [{ code: "2ly", label: "2LY" }, { code: "2s", label: "2S" }] },
  { label: "Year 3", dot: "dot-year3", colorVar: "--cal-4", classes: [{ code: "3b", label: "3B" }, { code: "3d", label: "3D" }] },
  { label: "Year 4", dot: "dot-year4", colorVar: "--cal-5", classes: [{ code: "4m", label: "4M" }, { code: "4w", label: "4W" }] },
  { label: "Year 5", dot: "dot-year5", colorVar: "--cal-6", classes: [{ code: "5l", label: "5L" }, { code: "5hp", label: "5HP" }] },
  { label: "Year 6", dot: "dot-year6", colorVar: "--cal-7", classes: [{ code: "6bt", label: "6BT" }, { code: "6r", label: "6R" }] },
];
const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School", dot: "dot-whole", colorVar: "--cal-neutral" };
const FOSPS = { code: "fosps", label: "FOSPS", dot: "dot-fosps", colorVar: "--cal-8" };

const ALL_CALENDARS = [
  WHOLE_SCHOOL,
  ...GROUPS.flatMap((g) => g.classes.map((c) => ({ ...c, dot: g.dot, colorVar: g.colorVar, groupLabel: g.label }))),
  FOSPS,
];

// Which calendars have a real subscribe link on the page yet (see
// docs/index.html's "Coming Soon" section) - only these get a toggle
// checkbox in the preview. Everything else still gets *fetched* below
// (ALL_CALENDARS, unchanged) so day-indexed data is ready the moment a
// calendar is un-hidden here; nothing else needs to change to launch one,
// just add its code to this set.
const LAUNCHED_CALENDARS = new Set([WHOLE_SCHOOL.code, "rr", "rgp"]);

const DEFAULT_ON = new Set([WHOLE_SCHOOL.code, FOSPS.code]);
const STORAGE_KEY = "stpauls-calendar-toggles";
const VIEW_STORAGE_KEY = "stpauls-calendar-view";
const PREVIEW_OPEN_STORAGE_KEY = "stpauls-calendar-preview-open";
const VIEWS = ["month", "week", "day"];

const TODAY = new Date();
const WINDOW_START = ICAL.Time.fromJSDate(addDays(TODAY, -90), true);
const WINDOW_END = ICAL.Time.fromJSDate(addDays(TODAY, 400), true);
const MAX_OCCURRENCES_PER_EVENT = 1000;
const MAX_CHIPS_PER_DAY = 3;
const MAX_CHIPS_PER_DAY_WEEK = 8;

const LONDON_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const LONDON_TIME_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function londonDateKey(jsDate) {
  return LONDON_DATE_FMT.format(jsDate); // en-CA -> YYYY-MM-DD
}

function icalDateKey(t) {
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

// ical.js's own VTIMEZONE offset math has trouble with the RDATE-list style
// VTIMEZONE that Python's icalendar (add_missing_timezones()) generates -
// past a DST change it can resolve the wrong offset for a TZID=Europe/London
// occurrence. Recompute the UTC instant ourselves from the wall-clock
// components using the browser's own (always-correct) Intl timezone data,
// which sidesteps that bug entirely and works regardless of the viewer's
// own device timezone.
function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function londonWallClockToUtc(year, month, day, hour, minute, second) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  const offset = timeZoneOffsetMs(new Date(utcGuess), "Europe/London");
  return new Date(utcGuess - offset);
}

function toReliableJsDate(icalTime) {
  if (icalTime.zone && icalTime.zone.tzid === "Europe/London") {
    return londonWallClockToUtc(icalTime.year, icalTime.month, icalTime.day, icalTime.hour, icalTime.minute, icalTime.second);
  }
  return icalTime.toJSDate();
}

// Defense in depth: scripts/build_ics.py and the class rep tool's
// validate.js both already reject non-http(s) URLs before they reach a
// published .ics file, but this is the actual XSS sink (an <a href> on a
// page every visitor loads) - never trust an upstream check alone here.
function isSafeUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function loadToggleState() {
  // Not-yet-launched calendars are always forced off here - defensive
  // against stale localStorage from before a calendar was un-launched (or,
  // now, from before this restriction existed at all) - not just "no
  // checkbox to turn it on with", but genuinely never shown even if an old
  // saved state says otherwise.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no saved state");
    const saved = JSON.parse(raw);
    const state = {};
    for (const cal of ALL_CALENDARS) state[cal.code] = LAUNCHED_CALENDARS.has(cal.code) && Boolean(saved[cal.code]);
    return state;
  } catch {
    const state = {};
    for (const cal of ALL_CALENDARS) state[cal.code] = LAUNCHED_CALENDARS.has(cal.code) && DEFAULT_ON.has(cal.code);
    return state;
  }
}

function saveToggleState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private browsing, etc) - toggles just won't persist
  }
}

function loadView() {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (VIEWS.includes(saved)) return saved;
  } catch {
    // localStorage unavailable - fall through to the default
  }
  return "month";
}

function saveView(view) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // localStorage unavailable - view choice just won't persist
  }
}

function loadPreviewOpenState() {
  try {
    return localStorage.getItem(PREVIEW_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function savePreviewOpenState(isOpen) {
  try {
    localStorage.setItem(PREVIEW_OPEN_STORAGE_KEY, String(isOpen));
  } catch {
    // localStorage unavailable - open/closed state just won't persist
  }
}

// The anchor date's meaning depends on the view: 1st-of-month for month
// view, the Monday of the week for week view, the exact day for day view.
function normalizeAnchor(date, view) {
  const plainDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (view === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  if (view === "week") {
    const mondayOffset = (plainDate.getDay() + 6) % 7;
    return addDays(plainDate, -mondayOffset);
  }
  return plainDate;
}

function formatDayLabel(date) {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatWeekLabel(monday) {
  const sunday = addDays(monday, 6);
  const start = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const end = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${end}`;
}

function expandInstance(cal, summary, description, url, startTime, endTime) {
  const allDay = startTime.isDate;
  const dayKeys = [];

  if (allDay) {
    const cursor = startTime.clone();
    while (cursor.compare(endTime) < 0) {
      dayKeys.push(icalDateKey(cursor));
      cursor.adjust(1, 0, 0, 0);
    }
  }

  const startJs = allDay ? startTime.toJSDate() : toReliableJsDate(startTime);
  const endJs = allDay ? endTime.toJSDate() : toReliableJsDate(endTime);

  if (!allDay) {
    let key = londonDateKey(startJs);
    const endKey = londonDateKey(endJs);
    let cursor = startJs;
    dayKeys.push(key);
    while (key < endKey) {
      cursor = addDays(cursor, 1);
      key = londonDateKey(cursor);
      dayKeys.push(key);
    }
  }

  return {
    code: cal.code,
    colorVar: cal.colorVar,
    calendarLabel: cal.groupLabel ? `${cal.groupLabel} (${cal.label})` : cal.label,
    title: summary || "(untitled event)",
    description: description || null,
    url: url || null,
    allDay,
    startJs,
    endJs,
    dayKeys: [...new Set(dayKeys)],
  };
}

async function loadCalendarInstances(cal) {
  const resp = await fetch(`calendars/${cal.code}.ics`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${cal.code}: HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text.trim()) return [];

  const comp = new ICAL.Component(ICAL.parse(text));
  for (const vtimezone of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtimezone);
    ICAL.TimezoneService.register(tz.tzid, tz);
  }

  const instances = [];

  for (const vevent of comp.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    const url = vevent.getFirstPropertyValue("url");

    if (!event.isRecurring()) {
      if (event.endDate.compare(WINDOW_START) < 0 || event.startDate.compare(WINDOW_END) > 0) continue;
      instances.push(expandInstance(cal, event.summary, event.description, url, event.startDate, event.endDate));
      continue;
    }

    const iterator = event.iterator();
    let next;
    let guard = 0;
    while ((next = iterator.next()) && guard < MAX_OCCURRENCES_PER_EVENT) {
      guard++;
      if (next.compare(WINDOW_END) > 0) break;
      if (next.compare(WINDOW_START) < 0) continue;
      const details = event.getOccurrenceDetails(next);
      instances.push(
        expandInstance(cal, details.item.summary, details.item.description, url, details.startDate, details.endDate)
      );
    }
  }
  return instances;
}

function buildDayIndex(instances) {
  const map = new Map();
  for (const inst of instances) {
    for (const key of inst.dayKeys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(inst);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startJs - b.startJs));
  }
  return map;
}

// --- UI ---

const el = {
  toggles: document.getElementById("calendar-toggles"),
  grid: document.getElementById("calendar-grid"),
  dayAgenda: document.getElementById("calendar-day-agenda"),
  monthLabel: document.getElementById("cal-month-label"),
  prevButton: document.getElementById("cal-prev"),
  nextButton: document.getElementById("cal-next"),
  todayButton: document.getElementById("cal-today"),
  refreshButton: document.getElementById("cal-refresh"),
  viewButtons: [...document.querySelectorAll(".view-button")],
  loading: document.getElementById("calendar-loading"),
  error: document.getElementById("calendar-error"),
  dialog: document.getElementById("day-dialog"),
  dialogTitle: document.getElementById("day-dialog-title"),
  dialogEvents: document.getElementById("day-dialog-events"),
  dialogClose: document.getElementById("day-dialog-close"),
};

let toggleState = loadToggleState();
let dayIndex = new Map();
let currentView = loadView();
let viewedDate = normalizeAnchor(TODAY, currentView);

function renderToggles() {
  el.toggles.innerHTML = "";

  const makeToggle = (cal) => {
    const label = document.createElement("label");
    label.className = "cal-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = toggleState[cal.code];
    checkbox.addEventListener("change", () => {
      toggleState[cal.code] = checkbox.checked;
      saveToggleState(toggleState);
      render();
    });
    const dot = document.createElement("span");
    dot.className = `cal-dot ${cal.dot}`;
    label.append(checkbox, dot, document.createTextNode(cal.groupLabel ? `${cal.groupLabel} ${cal.label}` : cal.label));
    return label;
  };

  // Only launched calendars get a checkbox at all (see LAUNCHED_CALENDARS)
  // - a not-yet-launched one has no working subscribe link on the page
  // either, so offering to preview it would be more confusing than
  // useful. A whole-school/FOSPS-style group is skipped entirely if
  // nothing in it is launched (e.g. FOSPS alone, right now); a year group
  // is skipped entirely if neither of its classes is launched.
  const topLevel = [WHOLE_SCHOOL, FOSPS].filter((cal) => LAUNCHED_CALENDARS.has(cal.code));
  if (topLevel.length > 0) {
    const wholeGroup = document.createElement("div");
    wholeGroup.className = "cal-toggle-group";
    wholeGroup.append(...topLevel.map(makeToggle));
    el.toggles.appendChild(wholeGroup);
  }

  for (const group of GROUPS) {
    const launchedClasses = group.classes.filter((cls) => LAUNCHED_CALENDARS.has(cls.code));
    if (launchedClasses.length === 0) continue;

    const groupEl = document.createElement("div");
    groupEl.className = "cal-toggle-group";
    const groupLabel = document.createElement("span");
    groupLabel.className = "cal-toggle-group-label";
    groupLabel.textContent = group.label;
    groupEl.appendChild(groupLabel);
    for (const cls of launchedClasses) {
      groupEl.appendChild(makeToggle({ ...cls, dot: group.dot }));
    }
    el.toggles.appendChild(groupEl);
  }
}

function buildDayCell(cellDate, { isOtherMonth = false, maxChips = MAX_CHIPS_PER_DAY } = {}) {
  const key = londonDateKey(cellDate);
  const todayKey = londonDateKey(TODAY);

  const cell = document.createElement("div");
  cell.className = "cal-day" + (isOtherMonth ? " other-month" : "") + (key === todayKey ? " is-today" : "");

  const number = document.createElement("span");
  number.className = "cal-day-number";
  number.textContent = String(cellDate.getDate());
  cell.appendChild(number);

  const dayEvents = (dayIndex.get(key) || []).filter((inst) => toggleState[inst.code]);
  for (const inst of dayEvents.slice(0, maxChips)) {
    const chip = document.createElement("div");
    chip.className = "cal-chip";
    chip.style.background = `var(${inst.colorVar})`;
    chip.style.color = `var(${inst.colorVar}-text)`;
    chip.textContent = inst.title;
    cell.appendChild(chip);
  }
  if (dayEvents.length > maxChips) {
    const more = document.createElement("div");
    more.className = "cal-more";
    more.textContent = `+${dayEvents.length - maxChips} more`;
    cell.appendChild(more);
  }

  if (dayEvents.length > 0) {
    const open = () => openDayDialog(cellDate, dayEvents);
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `${formatDayLabel(cellDate)}: ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`);
    cell.addEventListener("click", open);
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }

  return cell;
}

function renderWeekdayHeader() {
  for (const day of WEEKDAY_LABELS) {
    const cell = document.createElement("div");
    cell.className = "cal-weekday";
    cell.textContent = day;
    el.grid.appendChild(cell);
  }
}

function renderMonthGrid() {
  el.grid.className = "cal-grid";
  el.grid.innerHTML = "";
  renderWeekdayHeader();

  const mondayOffset = (viewedDate.getDay() + 6) % 7; // Monday-start week
  const gridStart = addDays(viewedDate, -mondayOffset);

  for (let i = 0; i < 42; i++) {
    const cellDate = addDays(gridStart, i);
    const isOtherMonth = cellDate.getMonth() !== viewedDate.getMonth();
    el.grid.appendChild(buildDayCell(cellDate, { isOtherMonth, maxChips: MAX_CHIPS_PER_DAY }));
  }
}

function renderWeekGrid() {
  el.grid.className = "cal-grid cal-grid--week";
  el.grid.innerHTML = "";
  renderWeekdayHeader();

  for (let i = 0; i < 7; i++) {
    const cellDate = addDays(viewedDate, i); // viewedDate is normalized to that week's Monday
    el.grid.appendChild(buildDayCell(cellDate, { maxChips: MAX_CHIPS_PER_DAY_WEEK }));
  }
}

function renderDayAgenda() {
  el.dayAgenda.innerHTML = "";
  const key = londonDateKey(viewedDate);
  const dayEvents = (dayIndex.get(key) || []).filter((inst) => toggleState[inst.code]);

  if (dayEvents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "howto";
    empty.textContent = "No events on this day for the calendars you've selected.";
    el.dayAgenda.appendChild(empty);
    return;
  }
  for (const inst of dayEvents) {
    el.dayAgenda.appendChild(renderEventRow(inst));
  }
}

function render() {
  if (currentView === "month") {
    el.monthLabel.textContent = MONTH_LABEL_FMT.format(viewedDate);
    el.grid.hidden = false;
    el.dayAgenda.hidden = true;
    renderMonthGrid();
  } else if (currentView === "week") {
    el.monthLabel.textContent = formatWeekLabel(viewedDate);
    el.grid.hidden = false;
    el.dayAgenda.hidden = true;
    renderWeekGrid();
  } else {
    el.monthLabel.textContent = formatDayLabel(viewedDate);
    el.grid.hidden = true;
    el.dayAgenda.hidden = false;
    renderDayAgenda();
  }
}

function renderEventRow(inst) {
  const row = document.createElement("div");
  row.className = "day-event";

  const title = document.createElement("div");
  title.className = "day-event-title";
  const dot = document.createElement("span");
  dot.className = "cal-dot";
  dot.style.background = `var(${inst.colorVar})`;
  title.append(dot, document.createTextNode(inst.title));
  row.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "day-event-time";
  const timeText = inst.allDay ? "All day" : `${LONDON_TIME_FMT.format(inst.startJs)}–${LONDON_TIME_FMT.format(inst.endJs)}`;
  meta.textContent = `${inst.calendarLabel} · ${timeText}`;
  row.appendChild(meta);

  if (inst.description) {
    const desc = document.createElement("div");
    desc.className = "day-event-desc";
    desc.textContent = inst.description;
    row.appendChild(desc);
  }
  if (inst.url && isSafeUrl(inst.url)) {
    const link = document.createElement("a");
    link.href = inst.url;
    link.textContent = "More info";
    link.className = "day-event-desc";
    link.rel = "noopener";
    row.appendChild(link);
  }

  return row;
}

function openDayDialog(date, dayEvents) {
  el.dialogTitle.textContent = formatDayLabel(date);
  el.dialogEvents.innerHTML = "";
  for (const inst of dayEvents) {
    el.dialogEvents.appendChild(renderEventRow(inst));
  }
  el.dialog.showModal();
}

function updateViewButtonStyles() {
  for (const btn of el.viewButtons) {
    const active = btn.dataset.view === currentView;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

// When switching view granularity, prefer keeping "today" in view (e.g.
// Month -> Week should land on today's week) rather than always deriving
// from the current anchor (which would land on the week containing the
// 1st of the month instead).
function isTodayInView() {
  if (currentView === "month") {
    return TODAY.getFullYear() === viewedDate.getFullYear() && TODAY.getMonth() === viewedDate.getMonth();
  }
  if (currentView === "week") {
    return TODAY >= viewedDate && TODAY < addDays(viewedDate, 7);
  }
  return londonDateKey(TODAY) === londonDateKey(viewedDate);
}

function shiftAnchor(delta) {
  if (currentView === "month") {
    viewedDate = new Date(viewedDate.getFullYear(), viewedDate.getMonth() + delta, 1);
  } else if (currentView === "week") {
    viewedDate = addDays(viewedDate, delta * 7);
  } else {
    viewedDate = addDays(viewedDate, delta);
  }
  render();
}

// Fetches + parses all 16 calendars and rebuilds dayIndex. Used both at
// startup and by the Refresh button - the .ics fetches already use
// cache: "no-cache" (loadCalendarInstances), so a re-run always gets live
// data with no extra cache-busting needed.
async function loadAllCalendarData() {
  const results = await Promise.allSettled(ALL_CALENDARS.map((cal) => loadCalendarInstances(cal)));
  const allInstances = [];
  let failures = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      allInstances.push(...result.value);
    } else {
      failures++;
      console.warn(`Couldn't load ${ALL_CALENDARS[i].code}:`, result.reason);
    }
  });
  dayIndex = buildDayIndex(allInstances);
  return { failures };
}

async function handleRefresh() {
  el.refreshButton.disabled = true;
  const originalText = el.refreshButton.textContent;
  el.refreshButton.textContent = "Refreshing…";
  el.error.hidden = true;

  const { failures } = await loadAllCalendarData();

  el.refreshButton.disabled = false;
  el.refreshButton.textContent = originalText;

  if (failures === ALL_CALENDARS.length) {
    el.error.textContent = "Couldn't refresh - try again.";
    el.error.hidden = false;
    return;
  }
  if (failures > 0) {
    el.error.textContent = `${failures} calendar(s) couldn't be refreshed - the rest are up to date.`;
    el.error.hidden = false;
  }
  render(); // redraws whatever view/date is currently shown, doesn't reset to today
}

async function init() {
  const previewDetails = document.getElementById("calendar-preview");
  if (previewDetails) {
    // Restore before anything else so there's no flash of collapsed-then-
    // reopens on a repeat visit.
    previewDetails.open = loadPreviewOpenState();
    previewDetails.addEventListener("toggle", () => savePreviewOpenState(previewDetails.open));
  }

  renderToggles();
  updateViewButtonStyles();

  el.prevButton.addEventListener("click", () => shiftAnchor(-1));
  el.nextButton.addEventListener("click", () => shiftAnchor(1));
  el.todayButton.addEventListener("click", () => {
    viewedDate = normalizeAnchor(TODAY, currentView);
    render();
  });
  el.refreshButton.addEventListener("click", handleRefresh);
  for (const btn of el.viewButtons) {
    btn.addEventListener("click", () => {
      const newView = btn.dataset.view;
      if (newView === currentView) return;
      const referenceDate = isTodayInView() ? TODAY : viewedDate;
      viewedDate = normalizeAnchor(referenceDate, newView);
      currentView = newView;
      saveView(currentView);
      updateViewButtonStyles();
      render();
    });
  }
  el.dialogClose.addEventListener("click", () => el.dialog.close());

  const { failures } = await loadAllCalendarData();
  el.loading.hidden = true;
  if (failures === ALL_CALENDARS.length) {
    el.error.textContent = "Couldn't load any calendars - try reloading the page.";
    el.error.hidden = false;
    return;
  }
  if (failures > 0) {
    el.error.textContent = `${failures} calendar(s) couldn't be loaded - the rest are shown below.`;
    el.error.hidden = false;
  }
  render();
}

init();
