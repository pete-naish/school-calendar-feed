import ICAL from "./vendor/ical.min.js";
import CLASSES from "../classes.js";

// The year groups and their classes come from docs/classes.js - the single
// source of truth shared with scripts/build_ics.py and the class rep tool.
// Relabel classes there, not here.
//
// Each year group's look is keyed by its `key` in that file. `colorVar` maps
// to the categorical palette in calendar.css: each year group and FOSPS is one
// hue from a single palette; "Everyone" (whole school) is a neutral grey
// rather than another hue since it's structurally the "everyone" bucket, not a
// peer category.
const GROUP_STYLES = {
  reception: { dot: "dot-reception", colorVar: "--cal-1" },
  year1: { dot: "dot-year1", colorVar: "--cal-2" },
  year2: { dot: "dot-year2", colorVar: "--cal-3" },
  year3: { dot: "dot-year3", colorVar: "--cal-4" },
  year4: { dot: "dot-year4", colorVar: "--cal-5" },
  year5: { dot: "dot-year5", colorVar: "--cal-6" },
  year6: { dot: "dot-year6", colorVar: "--cal-7" },
};

const GROUPS = CLASSES.yearGroups.map((g) => ({ ...g, ...GROUP_STYLES[g.key] }));
const WHOLE_SCHOOL = { code: "whole-school", label: "Whole School", dot: "dot-whole", colorVar: "--cal-neutral" };
const FOSPS = { code: "fosps", label: "FOSPS", dot: "dot-fosps", colorVar: "--cal-8" };

// The alphabetically first class in a year group takes the year's hue, the
// other a lighter tint of it (--cal-N-b in calendar.css), so siblings'
// classes tell apart in the grid and the rail without a text prefix. By label,
// not slot: a/b order drifts as classes are relabelled (see docs/classes.js
// and YEAR_GROUPS in scripts/build_ics.py), and this keeps the full hue on the
// top tile.
const ALL_CALENDARS = [
  WHOLE_SCHOOL,
  FOSPS,
  ...GROUPS.flatMap((g) => {
    const first = [...g.classes].sort((a, b) => a.label.localeCompare(b.label))[0];
    return g.classes.map((c) => ({ ...c, dot: g.dot, colorVar: c === first ? g.colorVar : `${g.colorVar}-b`, groupLabel: g.label }));
  }),
];

// Which calendars are launched. Only these get a row in the rail (preview
// toggle, see renderTiles) and are offered by the platform buttons
// (renderAddActions); the rest are named in the "coming soon" line.
// Everything else still gets *fetched* below (ALL_CALENDARS, unchanged) so
// day-indexed data is ready the moment a calendar is launched; launching
// one is just adding its code to this set - the page has no per-calendar
// markup of its own. All classes are launched now.
const LAUNCHED_CALENDARS = new Set([
  WHOLE_SCHOOL.code,
  FOSPS.code,
  "rec-a", "rec-b",
  "y1-a", "y1-b",
  "y2-a", "y2-b",
  "y3-a", "y3-b",
  "y4-a", "y4-b",
  "y5-a", "y5-b",
  "y6-a", "y6-b",
]);

const DEFAULT_ON = new Set([WHOLE_SCHOOL.code, FOSPS.code]);
const STORAGE_KEY = "stpauls-calendar-toggles";
// Toggles saved before class codes became generic (see YEAR_GROUPS in
// scripts/build_ics.py) were keyed by Reception's labels; carry them over so a
// returning visitor's ticked calendars aren't lost.
const LEGACY_TOGGLE_KEYS = { "rec-a": "rr", "rec-b": "rgp" };
const VIEW_STORAGE_KEY = "stpauls-calendar-view";
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
    for (const cal of ALL_CALENDARS) {
      const wasOn = saved[cal.code] ?? saved[LEGACY_TOGGLE_KEYS[cal.code]];
      state[cal.code] = LAUNCHED_CALENDARS.has(cal.code) && Boolean(wasOn);
    }
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

// build_ics.py prefixes every class/FOSPS event's published title with its
// calendar code ("RR: PE Kit") so subscribers with siblings can tell feeds
// apart in their own calendar app. In this preview the colour already does
// that job, so the prefix comes off for display only - the .ics is untouched.
function displayTitle(summary, cal) {
  if (!summary) return "(untitled event)";
  const code = cal.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = summary.replace(new RegExp("^" + code + ":\\s*", "i"), "");
  return stripped || summary;
}

function expandInstance(cal, summary, description, location, url, startTime, endTime) {
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
    calendarLabel: cal.groupLabel ? `${cal.groupLabel} ${cal.label}` : cal.label,
    title: displayTitle(summary, cal),
    description: description || null,
    location: location || null,
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
      instances.push(
        expandInstance(cal, event.summary, event.description, event.location, url, event.startDate, event.endDate)
      );
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
        expandInstance(
          cal,
          details.item.summary,
          details.item.description,
          details.item.location,
          url,
          details.startDate,
          details.endDate
        )
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
  comingSoon: document.getElementById("coming-soon"),
  addButtons: document.getElementById("calendar-add"),
  addHint: document.getElementById("calendar-add-hint"),
  addList: document.getElementById("calendar-add-list"),
  icsLinks: document.getElementById("ics-links"),
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

// The feed URLs are derived from where the page is served, so the same
// markup works on GitHub Pages and on a local http.server. webcal:// is
// what makes Apple Calendar / Outlook open a subscription instead of
// downloading the file.
function feedUrls(cal) {
  const https = new URL(`calendars/${cal.code}.ics`, window.location.href).href;
  // String swap, not URL.protocol: the URL spec ignores a change from a
  // special scheme (http/https) to a non-special one like webcal.
  return { https, webcal: https.replace(/^https?:/, "webcal:") };
}

function displayName(cal) {
  return cal.groupLabel ? `${cal.groupLabel} ${cal.label}` : cal.label;
}

// One link per (platform, calendar). Every platform subscribes to a single
// feed per link, which is why the buttons below fan out to a list when more
// than one calendar is ticked.
const PLATFORMS = [
  { key: "apple", label: "Apple Calendar", url: (cal) => feedUrls(cal).webcal },
  {
    key: "google",
    label: "Google Calendar",
    url: (cal) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrls(cal).webcal)}`,
  },
  {
    key: "outlook",
    label: "Outlook",
    url: (cal) =>
      `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrls(cal).https)}&name=${encodeURIComponent(
        `St Paul's: ${displayName(cal)}`
      )}`,
  },
];

function tileName(cal) {
  const name = document.createElement("span");
  name.className = "cal-tile-name";
  if (cal.groupLabel) {
    const code = document.createElement("span");
    code.className = "mono";
    code.textContent = cal.label;
    name.append(document.createTextNode(`${cal.groupLabel} `), code);
  } else {
    name.textContent = cal.label;
  }
  return name;
}

function launchedCalendars() {
  return ALL_CALENDARS.filter((cal) => LAUNCHED_CALENDARS.has(cal.code));
}

// Same calendars as launchedCalendars(), but with each year group's classes
// alphabetised by label (so parents can scan for their child's teacher)
// rather than left in build-config order. Used wherever calendars are listed
// for parents (the tiles, the per-app link list and "Other apps"). Groups
// stay in their original sequence and keep their classes adjacent, so this
// doesn't disturb the mobile two-column pairing in the @media rule for
// .cal-tiles.
function displayOrder() {
  const groups = new Map();
  for (const cal of launchedCalendars()) {
    const key = cal.groupLabel || cal.code;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cal);
  }
  return [...groups.values()].flatMap((classes) => classes.sort((a, b) => a.label.localeCompare(b.label)));
}

function renderTiles() {
  el.toggles.innerHTML = "";
  displayOrder().forEach((cal, i) => {
    const tile = document.createElement("div");
    // Whole School and FOSPS aren't half of a year-group pair, so they span
    // both mobile columns (see the @media rule in calendar.css) rather than
    // ending up next to an unrelated class - this relies on every launched
    // year group contributing its classes in twos, immediately after one
    // another, which holds as long as both of a year's classes are launched
    // together.
    tile.className = "cal-tile" + (cal.groupLabel ? "" : " cal-tile--wide");
    tile.style.setProperty("--tile-color", `var(${cal.colorVar})`);
    tile.style.setProperty("--i", i);

    const label = document.createElement("label");
    label.className = "cal-tile-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = toggleState[cal.code];
    checkbox.addEventListener("change", () => {
      toggleState[cal.code] = checkbox.checked;
      saveToggleState(toggleState);
      render();
      renderAddActions();
    });
    label.append(checkbox, tileName(cal));
    tile.appendChild(label);
    el.toggles.appendChild(tile);
  });
}

let openPlatform = null;

// Three platform buttons acting on the ticked calendars. Exactly one ticked:
// each button is a direct link. Several: each button discloses one link per
// ticked calendar underneath (a platform can only subscribe to one feed per
// click). None: buttons are disabled.
function renderAddActions() {
  if (!el.addButtons) return;
  const selected = displayOrder().filter((cal) => toggleState[cal.code]);
  el.addButtons.innerHTML = "";
  el.addList.innerHTML = "";
  el.addList.hidden = true;
  if (selected.length <= 1) openPlatform = null;

  for (const platform of PLATFORMS) {
    let control;
    if (selected.length === 1) {
      control = document.createElement("a");
      control.href = platform.url(selected[0]);
      control.setAttribute("aria-label", `Add ${displayName(selected[0])} to ${platform.label}`);
    } else if (selected.length === 0) {
      control = document.createElement("span");
      control.setAttribute("aria-disabled", "true");
      control.title = "Pick a calendar first";
    } else {
      control = document.createElement("button");
      control.type = "button";
      control.setAttribute("aria-expanded", String(openPlatform === platform.key));
      control.setAttribute("aria-controls", "calendar-add-list");
      control.addEventListener("click", () => {
        openPlatform = openPlatform === platform.key ? null : platform.key;
        renderAddActions();
      });
    }
    control.className = "cal-add";
    control.append(document.createTextNode(platform.label));
    el.addButtons.appendChild(control);
  }

  if (openPlatform && selected.length > 1) {
    const platform = PLATFORMS.find((p) => p.key === openPlatform);
    for (const cal of selected) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = platform.url(cal);
      link.textContent = `Subscribe to ${displayName(cal)}`;
      item.appendChild(link);
      el.addList.appendChild(item);
    }
    el.addList.hidden = false;
  }

  if (el.addHint) {
    el.addHint.innerHTML = "";
    if (selected.length === 0) {
      el.addHint.textContent = "Pick a calendar above to get started.";
    } else if (selected.length === 1) {
      const name = document.createElement("span");
      name.className = "cal-highlight";
      name.textContent = displayName(selected[0]);
      el.addHint.append("Tap your app below — it'll ask you to confirm before subscribing to ", name, ".");
    } else {
      el.addHint.textContent = "Tap your app below, then subscribe to each calendar separately.";
    }
  }
}

// Plain https feed addresses for apps not covered by the platform buttons.
function renderIcsLinks() {
  if (!el.icsLinks) return;
  el.icsLinks.innerHTML = "";
  for (const cal of displayOrder()) {
    const link = document.createElement("a");
    link.href = feedUrls(cal).https;
    link.textContent = displayName(cal);
    el.icsLinks.appendChild(link);
  }
}

// One short line naming what isn't launched yet, for the rail under the
// calendar list: "Years 1 to 6 follow once they're ready."
function renderComingSoon() {
  if (!el.comingSoon) return;
  const pendingGroups = GROUPS.filter((g) => g.classes.some((c) => !LAUNCHED_CALENDARS.has(c.code)));
  const pendingTop = [WHOLE_SCHOOL, FOSPS].filter((cal) => !LAUNCHED_CALENDARS.has(cal.code));
  if (pendingGroups.length === 0 && pendingTop.length === 0) {
    el.comingSoon.hidden = true;
    return;
  }
  const parts = [];
  if (pendingGroups.length > 0) {
    const first = pendingGroups[0].label;
    const last = pendingGroups[pendingGroups.length - 1].label;
    parts.push(pendingGroups.length === 1 ? first : `${first.replace(/^Year /, "Years ")} to ${last.replace(/^Year /, "")}`);
  }
  parts.push(...pendingTop.map((cal) => cal.label));
  const lead = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const verb = pendingGroups.length + pendingTop.length > 1 || pendingGroups.length > 0 ? "follow" : "follows";
  el.comingSoon.textContent = `${lead} ${verb} once they're ready.`;
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
    chip.title = inst.title;
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

// One event: time column, then title / calendar / location / description / link, with
// a bar in the calendar's colour down the left. Shared by the day dialog and
// the Day view agenda.
function renderEventRow(inst) {
  const row = document.createElement("article");
  row.className = "day-event";
  row.style.setProperty("--event-color", `var(${inst.colorVar})`);

  const time = document.createElement("div");
  time.className = "day-event-time";
  if (inst.allDay) {
    time.textContent = "All day";
  } else {
    const start = document.createElement("span");
    start.textContent = LONDON_TIME_FMT.format(inst.startJs);
    const end = document.createElement("span");
    end.textContent = LONDON_TIME_FMT.format(inst.endJs);
    time.append(start, end);
  }
  row.appendChild(time);

  const body = document.createElement("div");
  body.className = "day-event-body";

  const title = document.createElement("h4");
  title.className = "day-event-title";
  title.textContent = inst.title;
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "day-event-meta";
  meta.textContent = inst.calendarLabel;
  body.appendChild(meta);

  if (inst.location) {
    const place = document.createElement("div");
    place.className = "day-event-location";
    place.textContent = inst.location;
    body.appendChild(place);
  }

  if (inst.description) {
    const desc = document.createElement("p");
    desc.className = "day-event-desc";
    desc.textContent = inst.description;
    body.appendChild(desc);
  }
  if (inst.url && isSafeUrl(inst.url)) {
    const link = document.createElement("a");
    link.href = inst.url;
    link.textContent = "More info";
    link.className = "day-event-link";
    link.rel = "noopener";
    body.appendChild(link);
  }

  row.appendChild(body);
  return row;
}

function openDayDialog(date, dayEvents) {
  // "Monday" as a small label, then the date, so the weekday reads first.
  el.dialogTitle.innerHTML = "";
  const weekday = document.createElement("span");
  weekday.className = "day-dialog-weekday";
  weekday.textContent = date.toLocaleDateString("en-GB", { weekday: "long" });
  el.dialogTitle.append(weekday, document.createTextNode(date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })));
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
  renderTiles();
  renderComingSoon();
  renderAddActions();
  renderIcsLinks();
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
  // A click on the backdrop lands on the <dialog> itself, not on its
  // content, so this closes it without a wrapper element.
  el.dialog.addEventListener("click", (e) => {
    if (e.target === el.dialog) el.dialog.close();
  });

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
