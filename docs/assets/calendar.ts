import ICAL from "./vendor/ical.min.js";
import CLASSES from "../classes.js";
import type { YearGroupConfig } from "../classes.js";

type IcalTime = InstanceType<typeof ICAL.Time>;

// One of the calendars the page shows: a class, FOSPS or Whole School.
interface Calendar {
  code: string;
  label: string;
  dot: string;
  colorVar: string;
  groupLabel?: string;
}

type YearGroupView = YearGroupConfig & { dot: string; colorVar: string };

// One occurrence of an event, as the grid and the day list show it.
interface Instance {
  code: string;
  colorVar: string;
  calendarLabel: string;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  allDay: boolean;
  startJs: Date;
  endJs: Date;
  dayKeys: string[];
}

type View = "list" | "month" | "week" | "day";

// One entry in calendars/changes.json, written by scripts/build_ics.py's
// track_changes(): `start` is "YYYY-MM-DD" (all-day) or "YYYY-MM-DDTHH:MM"
// (London), `title` has no class prefix, and a "skipped" entry lists the
// newly skipped `dates` of a repeating event.
interface Change {
  calendar: string;
  uid: string;
  kind: "added" | "moved" | "cancelled" | "repeat" | "skipped";
  at: string;
  title: string;
  start: string;
  all_day: boolean;
  old_start?: string;
  dates?: string[];
}
type ToggleState = Record<string, boolean>;

// The year groups and their classes come from docs/classes.js - the single
// source of truth shared with scripts/build_ics.py and the class rep tool.
// Relabel classes there, not here.
//
// Each year group's look is keyed by its `key` in that file. `colorVar` maps
// to the categorical palette in calendar.css: each year group and FOSPS is one
// hue from a single palette; "Everyone" (whole school) is a neutral grey
// rather than another hue since it's structurally the "everyone" bucket, not a
// peer category.
const GROUP_STYLES: Record<string, { dot: string; colorVar: string }> = {
  reception: { dot: "dot-reception", colorVar: "--cal-1" },
  year1: { dot: "dot-year1", colorVar: "--cal-2" },
  year2: { dot: "dot-year2", colorVar: "--cal-3" },
  year3: { dot: "dot-year3", colorVar: "--cal-4" },
  year4: { dot: "dot-year4", colorVar: "--cal-5" },
  year5: { dot: "dot-year5", colorVar: "--cal-6" },
  year6: { dot: "dot-year6", colorVar: "--cal-7" },
};

const GROUPS: YearGroupView[] = CLASSES.yearGroups.map((g) => ({ ...g, ...GROUP_STYLES[g.key] }));
const WHOLE_SCHOOL: Calendar = { code: "whole-school", label: "Whole School", dot: "dot-whole", colorVar: "--cal-neutral" };
const FOSPS: Calendar = { code: "fosps", label: "FOSPS", dot: "dot-fosps", colorVar: "--cal-8" };

// The alphabetically first class in a year group takes the year's hue, the
// other a lighter tint of it (--cal-N-b in calendar.css), so siblings'
// classes tell apart in the grid and the rail without a text prefix. By label,
// not slot: a/b order drifts as classes are relabelled (see docs/classes.js
// and YEAR_GROUPS in scripts/build_ics.py), and this keeps the full hue on the
// top tile.
const ALL_CALENDARS: Calendar[] = [
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
const LEGACY_TOGGLE_KEYS: Record<string, string> = { "rec-a": "rr", "rec-b": "rgp" };
const VIEW_STORAGE_KEY = "stpauls-calendar-view";
const VIEWS: View[] = ["list", "month", "week", "day"];
// Phone-sized: the month grid's chips are too narrow to read, so List is the
// default view and Week (seven slivers) isn't offered.
const NARROW = window.matchMedia("(max-width: 600px)");
// The calendar app the parent picked in step 2, remembered for next time.
const APP_STORAGE_KEY = "stpauls-calendar-app";
// Which "Add" links (one per platform + calendar) have been tapped, so a
// parent working through several can see which are done ("1 of 3 added").
// Per tab session only: sessionStorage survives the Google/Outlook links
// navigating away and back, but a later visit starts fresh, since a tap isn't
// proof the subscription actually went through.
const CLICKED_STORAGE_KEY = "stpauls-subscribe-clicked";

const TODAY = new Date();
const WINDOW_START = ICAL.Time.fromJSDate(addDays(TODAY, -90), true);
const WINDOW_END = ICAL.Time.fromJSDate(addDays(TODAY, 400), true);
const MAX_OCCURRENCES_PER_EVENT = 1000;
const MAX_CHIPS_PER_DAY = 3;
const MAX_CHIPS_PER_DAY_WEEK = 8;
// The List view shows this many weeks ahead, and "Show more" adds as many again.
const LIST_WEEKS = 4;

const LONDON_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const LONDON_TIME_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function londonDateKey(jsDate: Date) {
  return LONDON_DATE_FMT.format(jsDate); // en-CA -> YYYY-MM-DD
}

function icalDateKey(t: IcalTime) {
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

// ical.js's own VTIMEZONE offset math has trouble with the RDATE-list style
// VTIMEZONE that Python's icalendar (add_missing_timezones()) generates -
// past a DST change it can resolve the wrong offset for a TZID=Europe/London
// occurrence. Recompute the UTC instant ourselves from the wall-clock
// components using the browser's own (always-correct) Intl timezone data,
// which sidesteps that bug entirely and works regardless of the viewer's
// own device timezone.
function timeZoneOffsetMs(date: Date, timeZone: string) {
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
    .reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.type]: Number(p.value) }), {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function londonWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  const offset = timeZoneOffsetMs(new Date(utcGuess), "Europe/London");
  return new Date(utcGuess - offset);
}

function toReliableJsDate(icalTime: IcalTime) {
  if (icalTime.zone && icalTime.zone.tzid === "Europe/London") {
    return londonWallClockToUtc(icalTime.year, icalTime.month, icalTime.day, icalTime.hour, icalTime.minute, icalTime.second);
  }
  return icalTime.toJSDate();
}

// Defense in depth: scripts/build_ics.py and the class rep tool's
// validate.ts both already reject non-http(s) URLs before they reach a
// published .ics file, but this is the actual XSS sink (an <a href> on a
// page every visitor loads) - never trust an upstream check alone here.
function isSafeUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function loadToggleState(): ToggleState {
  // Not-yet-launched calendars are always forced off here - defensive
  // against stale localStorage from before a calendar was un-launched (or,
  // now, from before this restriction existed at all) - not just "no
  // checkbox to turn it on with", but genuinely never shown even if an old
  // saved state says otherwise.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no saved state");
    const saved = JSON.parse(raw);
    const state: ToggleState = {};
    for (const cal of ALL_CALENDARS) {
      const wasOn = saved[cal.code] ?? saved[LEGACY_TOGGLE_KEYS[cal.code]];
      state[cal.code] = LAUNCHED_CALENDARS.has(cal.code) && Boolean(wasOn);
    }
    return state;
  } catch {
    const state: ToggleState = {};
    for (const cal of ALL_CALENDARS) state[cal.code] = LAUNCHED_CALENDARS.has(cal.code) && DEFAULT_ON.has(cal.code);
    return state;
  }
}

// A share link - calendar.nai.sh/?c=rec-a from a class rep (the rep tool's
// Share tab), or ?c=rec-a,y5-a from another parent's "Share these calendars" -
// ticks those calendars on arrival. It adds to whatever's already ticked
// rather than replacing it, so a parent following two reps' links (one per
// child) ends up with both. The parameter is then dropped from the address
// bar, so a refresh or a bookmark doesn't keep re-ticking them once they've
// been unticked. Unknown codes are ignored.
function applyLinkedCalendars(): Calendar[] {
  let codes: string[];
  try {
    const url = new URL(window.location.href);
    const param = url.searchParams.get("c");
    if (param === null) return [];
    codes = param.split(",").map((c) => c.trim());
    url.searchParams.delete("c");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch {
    return [];
  }
  const cals = ALL_CALENDARS.filter((c) => codes.includes(c.code) && LAUNCHED_CALENDARS.has(c.code));
  for (const cal of cals) toggleState[cal.code] = true;
  if (cals.length) saveToggleState(toggleState);
  return cals;
}

function saveToggleState(state: ToggleState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private browsing, etc) - toggles just won't persist
  }
}

function loadView(): View {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(VIEW_STORAGE_KEY);
  } catch {
    // localStorage unavailable - fall through to the default
  }
  if (saved === "week" && NARROW.matches) return "list";
  if (VIEWS.includes(saved as View)) return saved as View;
  return NARROW.matches ? "list" : "month";
}

function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // localStorage unavailable - view choice just won't persist
  }
}

// The app picked last time, else a guess from the device: Apple's own
// devices use Apple Calendar, Android uses Google's. Anyone else can switch.
function loadPlatform(): string {
  try {
    const saved = localStorage.getItem(APP_STORAGE_KEY);
    if (PLATFORMS.some((p) => p.key === saved)) return saved as string;
  } catch {
    // localStorage unavailable - guess
  }
  if (/iPhone|iPad|Macintosh/.test(navigator.userAgent)) return "apple";
  return "google";
}

function savePlatform(key: string) {
  try {
    localStorage.setItem(APP_STORAGE_KEY, key);
  } catch {
    // localStorage unavailable - the choice just won't persist
  }
}

function loadClickedLinks(): Set<string> {
  try {
    // JSON.parse(null) is null: nothing saved yet.
    const saved = JSON.parse(sessionStorage.getItem(CLICKED_STORAGE_KEY) as string);
    if (Array.isArray(saved)) return new Set(saved);
  } catch {
    // sessionStorage unavailable or unreadable - start with nothing clicked
  }
  return new Set();
}

function saveClickedLinks(clicked: Set<string>) {
  try {
    sessionStorage.setItem(CLICKED_STORAGE_KEY, JSON.stringify([...clicked]));
  } catch {
    // sessionStorage unavailable - the grey-out just won't survive a reload
  }
}

// The anchor date's meaning depends on the view: 1st-of-month for month
// view, the Monday of the week for week view, the exact day for day view.
function normalizeAnchor(date: Date, view: View) {
  const plainDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (view === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  if (view === "week") {
    const mondayOffset = (plainDate.getDay() + 6) % 7;
    return addDays(plainDate, -mondayOffset);
  }
  return plainDate;
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Written out by hand: en-GB abbreviates September as "Sept".
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "28 Sep – 4 Oct 2026"
function formatWeekLabel(monday: Date) {
  const sunday = addDays(monday, 6);
  const start = `${monday.getDate()} ${MONTHS_SHORT[monday.getMonth()]}`;
  const end = `${sunday.getDate()} ${MONTHS_SHORT[sunday.getMonth()]} ${sunday.getFullYear()}`;
  return `${start} – ${end}`;
}

// "Mon 2 Nov", for the List view.
function formatShortDate(date: Date) {
  return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

// build_ics.py prefixes every class/FOSPS event's published title with its
// calendar code ("RR: PE Kit") so subscribers with siblings can tell feeds
// apart in their own calendar app. In this preview the colour already does
// that job, so the prefix comes off for display only - the .ics is untouched.
function displayTitle(summary: string, cal: Calendar) {
  if (!summary) return "(untitled event)";
  const code = cal.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = summary.replace(new RegExp("^" + code + ":\\s*", "i"), "");
  return stripped || summary;
}

function expandInstance(
  cal: Calendar,
  summary: string,
  description: string,
  location: string,
  url: unknown,
  startTime: IcalTime,
  endTime: IcalTime
): Instance {
  const allDay = startTime.isDate;
  const dayKeys: string[] = [];

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
    url: (url as string) || null,
    allDay,
    startJs,
    endJs,
    dayKeys: [...new Set(dayKeys)],
  };
}

async function loadCalendarInstances(cal: Calendar): Promise<Instance[]> {
  const resp = await fetch(`calendars/${cal.code}.ics`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${cal.code}: HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text.trim()) return [];

  const comp = new ICAL.Component(ICAL.parse(text));
  for (const vtimezone of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtimezone);
    ICAL.TimezoneService.register(tz, tz.tzid);
  }

  const instances: Instance[] = [];

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

function buildDayIndex(instances: Instance[]) {
  const map = new Map<string, Instance[]>();
  for (const inst of instances) {
    for (const key of inst.dayKeys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inst);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startJs.getTime() - b.startJs.getTime()));
  }
  return map;
}

// --- UI ---

// The page's own elements - always there, since index.html and this ship
// together. The few looked up with plain getElementById() are optional.
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const el = {
  toggles: byId("calendar-toggles"),
  pickHint: byId("pick-hint"),
  comingSoon: document.getElementById("coming-soon"),
  platformChoice: byId("platform-choice"),
  addProgress: byId("add-progress"),
  addProgressCount: byId("add-progress-count"),
  addProgressFill: byId("add-progress-fill"),
  addHint: byId("calendar-add-hint"),
  addList: byId<HTMLUListElement>("calendar-add-list"),
  addGoogleNote: byId("calendar-add-google"),
  icsLinks: byId<HTMLUListElement>("ics-links"),
  grid: byId("calendar-grid"),
  dayAgenda: byId("calendar-day-agenda"),
  list: byId("calendar-list"),
  legend: byId<HTMLUListElement>("calendar-legend"),
  navDates: byId("cal-nav-dates"),
  monthLabel: byId("cal-month-label"),
  prevButton: byId<HTMLButtonElement>("cal-prev"),
  nextButton: byId<HTMLButtonElement>("cal-next"),
  todayButton: byId<HTMLButtonElement>("cal-today"),
  refreshButton: byId<HTMLButtonElement>("cal-refresh"),
  viewButtons: [...document.querySelectorAll<HTMLButtonElement>(".view-button")],
  loading: byId("calendar-loading"),
  error: byId("calendar-error"),
  dialog: byId<HTMLDialogElement>("day-dialog"),
  dialogTitle: byId("day-dialog-title"),
  dialogEvents: byId("day-dialog-events"),
  dialogClose: byId<HTMLButtonElement>("day-dialog-close"),
  dayOff: byId("cal-dayoff"),
  changes: byId("cal-changes"),
  printButton: byId<HTMLButtonElement>("cal-print"),
  printHeading: byId("print-heading"),
  shareButton: byId<HTMLButtonElement>("share-selection"),
  shareStatus: byId("share-selection-status"),
};

let toggleState = loadToggleState();
const linkedCalendars = applyLinkedCalendars();
const clickedLinks = loadClickedLinks();
let dayIndex = new Map<string, Instance[]>();
let currentView = loadView();
let viewedDate = normalizeAnchor(TODAY, currentView);

// The feed URLs are derived from where the page is served, so the same
// markup works on GitHub Pages and on a local http.server. webcal:// is
// what makes Apple Calendar / Outlook open a subscription instead of
// downloading the file.
function feedUrls(cal: Calendar) {
  const https = new URL(`calendars/${cal.code}.ics`, window.location.href).href;
  // String swap, not URL.protocol: the URL spec ignores a change from a
  // special scheme (http/https) to a non-special one like webcal.
  return { https, webcal: https.replace(/^https?:/, "webcal:") };
}

// Anonymous subscribe-click counts: one beacon per subscribe link clicked,
// holding only which calendar and which app - no cookies, no identifiers, and
// nothing sent on page load. The endpoint is the class rep tool's own
// (tool/functions/api/subscribe-click.ts), which keeps a monthly tally per
// pair and nothing else. Only the live site counts, so local testing doesn't.
const STATS_URL = "https://calendar-admin.nai.sh/api/subscribe-click";
const STATS_HOST = "calendar.nai.sh";

function tagClick(link: HTMLElement, cal: Calendar, platform: string) {
  link.dataset.cal = cal.code;
  link.dataset.platform = platform;
}

// One beacon: which calendar, which app. Only from the live site.
function sendCount(calendar: string | undefined, platform: string | undefined) {
  if (window.location.hostname !== STATS_HOST) return;
  try {
    navigator.sendBeacon(STATS_URL, JSON.stringify({ calendar, platform }));
  } catch {
    // Never let counting get in the way of subscribing.
  }
}

function countClick(event: Event) {
  const link = (event.target as Element).closest<HTMLElement>("[data-cal]");
  if (link) sendCount(link.dataset.cal, link.dataset.platform);
}

function displayName(cal: Calendar) {
  return cal.groupLabel ? `${cal.groupLabel} ${cal.label}` : cal.label;
}

// One link per (platform, calendar). Every platform subscribes to a single
// feed per link, which is why the buttons below fan out to a list when more
// than one calendar is ticked.
const PLATFORMS: { key: string; label: string; short: string; url: (cal: Calendar) => string }[] = [
  { key: "apple", label: "Apple Calendar", short: "Apple", url: (cal) => feedUrls(cal).webcal },
  {
    key: "google",
    label: "Google Calendar",
    short: "Google",
    url: (cal) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrls(cal).webcal)}`,
  },
  {
    key: "outlook",
    label: "Outlook",
    short: "Outlook",
    url: (cal) =>
      `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrls(cal).https)}&name=${encodeURIComponent(
        `St Paul's: ${displayName(cal)}`
      )}`,
  },
];

let platform = loadPlatform();

// "Year 1 1S": the year group muted, the class itself in bold.
function tileName(cal: Calendar) {
  const name = document.createElement("span");
  name.className = "cal-tile-name";
  if (cal.groupLabel) {
    const year = document.createElement("span");
    year.className = "cal-tile-year";
    year.textContent = cal.groupLabel;
    const code = document.createElement("strong");
    code.textContent = cal.label;
    name.append(year, " ", code);
  } else {
    const strong = document.createElement("strong");
    strong.textContent = cal.label;
    name.append(strong);
  }
  return name;
}

function launchedCalendars() {
  return ALL_CALENDARS.filter((cal) => LAUNCHED_CALENDARS.has(cal.code));
}

// Same calendars as launchedCalendars(), but with each year group's classes
// alphabetised by label (so parents can scan for their child's teacher)
// rather than left in build-config order. Used wherever calendars are listed
// for parents (the tiles, the add checklist and the copy rows). Groups stay in
// their original sequence and keep their classes adjacent, so each year's two
// classes share a row of the two-column tile grid.
function displayOrder() {
  const groups = new Map<string, Calendar[]>();
  for (const cal of launchedCalendars()) {
    const key = cal.groupLabel || cal.code;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cal);
  }
  return [...groups.values()].flatMap((classes) => classes.sort((a, b) => a.label.localeCompare(b.label)));
}

function selectedCalendars() {
  return displayOrder().filter((cal) => toggleState[cal.code]);
}

// Step 1: a row per calendar - a checkbox in the calendar's colour (so the
// list doubles as the key) and its name. Ticking one also shows its events in
// the preview, and adds it to step 2's checklist.
function renderTiles() {
  el.toggles.innerHTML = "";
  for (const cal of displayOrder()) {
    const label = document.createElement("label");
    label.className = "cal-tile";
    label.style.setProperty("--tile-color", `var(${cal.colorVar})`);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = toggleState[cal.code];
    checkbox.addEventListener("change", () => {
      toggleState[cal.code] = checkbox.checked;
      label.classList.toggle("is-on", checkbox.checked);
      saveToggleState(toggleState);
      render();
      renderAddActions();
      renderShareSelection();
    });
    label.classList.toggle("is-on", checkbox.checked);
    label.append(checkbox, tileName(cal));
    el.toggles.appendChild(label);
  }
}

// A returning visitor (or one who's changed the defaults) doesn't need telling
// what we ticked for them.
function renderPickHint() {
  const strong = (text: string) => Object.assign(document.createElement("strong"), { textContent: text });
  const linked = linkedCalendars.filter((cal) => !DEFAULT_ON.has(cal.code));
  if (linked.length) {
    el.pickHint.innerHTML = "";
    el.pickHint.append("We've ticked ");
    linked.forEach((cal, i) => {
      if (i > 0) el.pickHint.append(i === linked.length - 1 ? " and " : ", ");
      el.pickHint.append(strong(cal.groupLabel ? `${cal.groupLabel} ${cal.label}` : cal.label));
    });
    el.pickHint.append(" for you. Tick any others you want, then add them in step 2.");
    return;
  }
  const onlyDefaults = displayOrder().every((cal) => toggleState[cal.code] === DEFAULT_ON.has(cal.code));
  if (!onlyDefaults) return;
  el.pickHint.innerHTML = "";
  el.pickHint.append("We've ticked ", strong("Whole School"), " and ", strong("FOSPS"), ". Add your child's class.");
}

// Step 2's app choice: Apple Calendar / Google Calendar / Outlook, one
// pressed. On a phone the labels shorten to Apple / Google / Outlook.
function renderPlatformChoice() {
  el.platformChoice.innerHTML = "";
  for (const p of PLATFORMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(p.key === platform));
    const long = Object.assign(document.createElement("span"), { className: "label-long", textContent: p.label });
    const short = Object.assign(document.createElement("span"), { className: "label-short", textContent: p.short });
    button.append(long, short);
    button.addEventListener("click", () => {
      platform = p.key;
      savePlatform(platform);
      renderPlatformChoice();
      renderAddActions();
    });
    el.platformChoice.appendChild(button);
  }
}

function isAdded(cal: Calendar) {
  return clickedLinks.has(`${platform}:${cal.code}`);
}

// An add link, before and after it's been tapped: "Add to Apple Calendar"
// (just "Add" on a phone), then a tick and "Added" - still a link, in case the
// app didn't open the first time.
function fillAddLink(link: HTMLAnchorElement, cal: Calendar, p: (typeof PLATFORMS)[number]) {
  link.innerHTML = "";
  const added = isAdded(cal);
  link.classList.toggle("is-added", added);
  if (added) {
    link.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    link.append("Added");
    link.setAttribute("aria-label", `Added ${displayName(cal)} to ${p.label} - tap to add it again`);
  } else {
    const long = Object.assign(document.createElement("span"), { className: "label-long", textContent: `Add to ${p.label}` });
    const short = Object.assign(document.createElement("span"), { className: "label-short", textContent: "Add" });
    link.append(long, short);
    link.setAttribute("aria-label", `Add ${displayName(cal)} to ${p.label}`);
  }
}

function renderProgress(selected: Calendar[]) {
  const done = selected.filter(isAdded).length;
  el.addProgress.hidden = selected.length < 2;
  el.addProgressCount.textContent = `${done} of ${selected.length} added`;
  el.addProgressFill.style.width = `${selected.length ? (done / selected.length) * 100 : 0}%`;
}

// Step 2's checklist: one row per ticked calendar, each with its own link,
// since a calendar app only takes one subscription per tap.
function renderAddActions() {
  const selected = selectedCalendars();
  const p = PLATFORMS.find((x) => x.key === platform)!;
  el.addList.innerHTML = "";

  for (const cal of selected) {
    const item = document.createElement("li");
    item.className = "add-row";
    item.style.setProperty("--dot-color", `var(${cal.colorVar})`);
    const dot = Object.assign(document.createElement("span"), { className: "add-dot" });
    dot.setAttribute("aria-hidden", "true");
    const link = document.createElement("a");
    link.className = "add-link";
    link.href = p.url(cal);
    tagClick(link, cal, p.key);
    fillAddLink(link, cal, p);
    // Updated in place rather than re-rendered: replacing the link while it's
    // being clicked can stop the browser following it.
    link.addEventListener("click", () => {
      clickedLinks.add(`${p.key}:${cal.code}`);
      saveClickedLinks(clickedLinks);
      fillAddLink(link, cal, p);
      renderProgress(selected);
    });
    item.append(dot, tileName(cal), link);
    el.addList.appendChild(item);
  }
  renderProgress(selected);

  if (selected.length === 0) {
    el.addHint.textContent = "Tick a calendar in step 1 first.";
  } else {
    el.addHint.textContent =
      selected.length === 1
        ? "Your app asks you to confirm. After that, new dates appear on their own - no need to come back."
        : "Your app asks you to confirm each one. After that, new dates appear on their own - no need to come back.";
  }

  // Google Calendar often leaves a calendar added on the web hidden (or, on
  // Android, unsynced) in its phone app until the parent ticks it there, and
  // nothing in the cid link can change that. Point at the how-to in Help.
  el.addGoogleNote.hidden = selected.length === 0 || platform !== "google";
}

// For apps without a button: each calendar's plain https address, to copy and
// paste into the app. Copied, never opened - opening it would make most
// phones import a one-off copy that never updates. Where copying isn't
// allowed, the address is shown to copy by hand.
function renderIcsLinks() {
  el.icsLinks.innerHTML = "";
  for (const cal of displayOrder()) {
    const url = feedUrls(cal).https;
    const item = document.createElement("li");
    item.className = "copy-row";
    const name = Object.assign(document.createElement("span"), { className: "copy-name", textContent: displayName(cal) });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", `Copy the address for ${displayName(cal)}`);
    tagClick(button, cal, "link");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Copied";
        button.classList.add("is-copied");
        setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("is-copied");
        }, 2500);
      } catch {
        if (!item.querySelector("code")) {
          const code = Object.assign(document.createElement("code"), { textContent: url });
          item.append(code);
        }
        button.textContent = "Copy it below";
      }
    });
    item.append(name, button);
    el.icsLinks.appendChild(item);
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
  const parts: string[] = [];
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

// A chip's colours: the calendar's own, unless it has quieter ones for chips -
// Whole School's light grey (--cal-neutral-chip in calendar.css), so the most
// common events don't drown out a class's colour.
function chipBackground(colorVar: string) {
  return `var(${colorVar}-chip, var(${colorVar}))`;
}

function chipText(colorVar: string) {
  return `var(${colorVar}-chip-text, var(${colorVar}-text))`;
}

function buildDayCell(cellDate: Date, { isOtherMonth = false, maxChips = MAX_CHIPS_PER_DAY } = {}) {
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
    chip.style.background = chipBackground(inst.colorVar);
    chip.style.color = chipText(inst.colorVar);
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

// Which colour is which, for the calendars ticked.
function renderLegend() {
  el.legend.innerHTML = "";
  for (const cal of selectedCalendars()) {
    const item = document.createElement("li");
    const swatch = Object.assign(document.createElement("span"), { className: "cal-legend-swatch" });
    swatch.style.background = chipBackground(cal.colorVar);
    item.append(swatch, displayName(cal));
    el.legend.appendChild(item);
  }
}

// How many weeks the List view shows; "Show more" adds LIST_WEEKS each time.
let listWeeks = LIST_WEEKS;

function dateFromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// The line under an event in the List view: its calendar, then its time, or
// its days if it runs over several.
function listMeta(inst: Instance) {
  let when;
  if (inst.dayKeys.length > 1) {
    when = `${formatShortDate(dateFromKey(inst.dayKeys[0]))} – ${formatShortDate(dateFromKey(inst.dayKeys[inst.dayKeys.length - 1]))}`;
  } else if (inst.allDay) {
    when = "All day";
  } else {
    when = `${LONDON_TIME_FMT.format(inst.startJs)}–${LONDON_TIME_FMT.format(inst.endJs)}`;
  }
  return `${inst.calendarLabel} · ${when}`;
}

// The List view: the coming weeks' events, by day, from today. An event over
// several days is listed once, on its first day still to come. Tapping one
// opens that day, as in the grid.
function renderList() {
  el.list.innerHTML = "";
  const todayKey = londonDateKey(TODAY);
  const endKey = londonDateKey(addDays(TODAY, listWeeks * 7));
  const keys = [...dayIndex.keys()].filter((k) => k >= todayKey && k < endKey).sort();
  const listed = new Set<Instance>();
  let shown = 0;

  for (const key of keys) {
    const dayEvents = (dayIndex.get(key) || []).filter((inst) => toggleState[inst.code]);
    const fresh = dayEvents.filter((inst) => !listed.has(inst));
    if (fresh.length === 0) continue;
    fresh.forEach((inst) => listed.add(inst));
    const date = dateFromKey(key);

    const day = document.createElement("div");
    day.className = "cal-list-day";
    const when = document.createElement("div");
    when.className = "cal-list-date";
    when.append(
      Object.assign(document.createElement("span"), { className: "cal-list-weekday", textContent: WEEKDAYS_SHORT[date.getDay()] }),
      Object.assign(document.createElement("span"), { className: "cal-list-daynum", textContent: String(date.getDate()) }),
      Object.assign(document.createElement("span"), { className: "cal-list-month", textContent: MONTHS_SHORT[date.getMonth()] })
    );
    if (key === todayKey) when.append(Object.assign(document.createElement("span"), { className: "cal-list-today", textContent: "Today" }));

    const items = document.createElement("div");
    items.className = "cal-list-items";
    for (const inst of fresh) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cal-list-item";
      button.style.setProperty("--dot-color", chipBackground(inst.colorVar));
      const text = document.createElement("span");
      text.className = "cal-list-text";
      text.append(
        Object.assign(document.createElement("span"), { className: "cal-list-title", textContent: inst.title }),
        Object.assign(document.createElement("span"), { className: "cal-list-meta", textContent: listMeta(inst) })
      );
      // On screen the place is in the day's dialog; a printout has no dialog.
      if (inst.location) {
        text.append(Object.assign(document.createElement("span"), { className: "cal-list-location", textContent: inst.location }));
      }
      button.append(Object.assign(document.createElement("span"), { className: "cal-list-dot" }), text);
      button.addEventListener("click", () => openDayDialog(date, dayEvents));
      items.appendChild(button);
    }
    day.append(when, items);
    el.list.appendChild(day);
    shown++;
  }

  if (shown === 0) {
    const empty = document.createElement("p");
    empty.className = "howto";
    empty.textContent = selectedCalendars().length
      ? `Nothing in the next ${listWeeks} weeks for the calendars you've picked.`
      : "Tick a calendar above to see its events.";
    el.list.appendChild(empty);
  }
  if (londonDateKey(addDays(TODAY, listWeeks * 7)) < icalDateKey(WINDOW_END)) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "cal-list-more";
    more.textContent = "Show more";
    more.addEventListener("click", () => {
      listWeeks += LIST_WEEKS;
      render();
    });
    el.list.appendChild(more);
  }
}

// --- Next day off, and the end of term ---

// The same keywords scripts/build_ics.py uses for closure days (its
// _CLOSURE_KEYWORDS - the days a repeating class event skips), and the rep
// tool's "Last Day of ... Term" match (TERM_END_PATTERN in
// tool/functions/api/_shared/termEnd.ts). tests/test_public_site.py keeps the
// three in step.
const CLOSURE_PATTERN = /\bINSET\b|\bHALF TERM\b|\bHOLIDAY\b/i;
const TERM_END_PATTERN = /last day of.*term/i;

// The first whole-school event from today whose title matches `pattern`, and
// the day it starts (or today, for one already under way). Whole School is
// always loaded, ticked or not.
function nextWholeSchool(pattern: RegExp): { inst: Instance; firstKey: string } | null {
  const todayKey = londonDateKey(TODAY);
  const keys = [...dayIndex.keys()].filter((k) => k >= todayKey).sort();
  for (const key of keys) {
    const inst = (dayIndex.get(key) || []).find((i) => i.code === WHOLE_SCHOOL.code && pattern.test(i.title));
    if (inst) return { inst, firstKey: key };
  }
  return null;
}

function daysFromToday(key: string) {
  return Math.round((dateFromKey(key).getTime() - dateFromKey(londonDateKey(TODAY)).getTime()) / 86400000);
}

function inDays(key: string) {
  const days = daysFromToday(key);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}

function termEndKey() {
  return nextWholeSchool(TERM_END_PATTERN)?.firstKey ?? null;
}

// The whole-school closure titles on `key`, if it's a day off.
function closuresOn(key: string) {
  return (dayIndex.get(key) || []).filter((i) => i.code === WHOLE_SCHOOL.code && CLOSURE_PATTERN.test(i.title));
}

// The next run of days off: the first closure day from today, extended over
// any closure days that follow - with a weekend between them - so INSET days
// running into half term read as one break ("Wed 21 Oct – Fri 30 Oct"), and
// the day it ends is the last closure day, not the weekend after it.
function nextDaysOff(): { firstKey: string; lastKey: string; titles: string[] } | null {
  const first = nextWholeSchool(CLOSURE_PATTERN);
  if (!first) return null;
  const titles = new Set<string>();
  let lastKey = first.firstKey;
  let day = dateFromKey(first.firstKey);
  for (let i = 0; i < 60; i++) {
    const key = londonDateKey(day);
    const closures = closuresOn(key);
    if (closures.length) {
      closures.forEach((c) => titles.add(c.title));
      lastKey = key;
    } else if (day.getDay() !== 0 && day.getDay() !== 6) {
      break; // a school day
    }
    day = addDays(day, 1);
  }
  return { firstKey: first.firstKey, lastKey, titles: [...titles] };
}

// "Next day off: Wed 21 – Fri 30 Oct · INSET Day, then Half Term · in 16 days · Term ends Fri 18 Dec"
function renderDayOff() {
  el.dayOff.innerHTML = "";
  const off = nextDaysOff();
  const termEnd = termEndKey();
  el.dayOff.hidden = !off && !termEnd;
  if (off) {
    const first = dateFromKey(off.firstKey);
    const when = off.lastKey !== off.firstKey ? `${formatShortDate(first)} – ${formatShortDate(dateFromKey(off.lastKey))}` : formatShortDate(first);
    const item = Object.assign(document.createElement("p"), { className: "cal-dayoff-item" });
    item.append(
      Object.assign(document.createElement("span"), { className: "cal-strip-label", textContent: "Next day off" }),
      Object.assign(document.createElement("strong"), { textContent: when }),
      ` · ${off.titles.join(", then ")} · ${inDays(off.firstKey)}`
    );
    el.dayOff.append(item);
  }
  if (termEnd) {
    const item = Object.assign(document.createElement("p"), { className: "cal-dayoff-item" });
    item.append(
      Object.assign(document.createElement("span"), { className: "cal-strip-label", textContent: "Term ends" }),
      Object.assign(document.createElement("strong"), { textContent: formatShortDate(dateFromKey(termEnd)) }),
      ` · ${inDays(termEnd)}`
    );
    el.dayOff.append(item);
  }
}

// --- Recently changed ---

// What changes.json says, for the ticked calendars - loaded with the feeds.
let changes: Change[] = [];
let showAllChanges = false;
const CHANGES_DAYS = 14;
const CHANGES_SHOWN = 5;

async function loadChanges() {
  try {
    const resp = await fetch("calendars/changes.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    changes = Array.isArray(data?.changes) ? data.changes.filter((c: Change) => c && typeof c.start === "string" && typeof c.at === "string") : [];
  } catch (err) {
    // Not there yet, or unreadable: the strip just doesn't show.
    console.warn("Couldn't load recent changes:", err);
    changes = [];
  }
}

// "Fri 10 Oct" or "Fri 10 Oct, 09:30"
function formatChangeDate(start: string, allDay: boolean) {
  const day = formatShortDate(dateFromKey(start.slice(0, 10)));
  return allDay || start.length < 16 ? day : `${day}, ${start.slice(11, 16)}`;
}

function changeText(c: Change) {
  switch (c.kind) {
    case "added":
      return `New · ${formatChangeDate(c.start, c.all_day)}`;
    case "moved":
      return c.old_start
        ? `Moved from ${formatChangeDate(c.old_start, c.all_day)} to ${formatChangeDate(c.start, c.all_day)}`
        : `Moved to ${formatChangeDate(c.start, c.all_day)}`;
    case "cancelled":
      return `Cancelled · ${formatChangeDate(c.start, c.all_day)}`;
    case "skipped":
      return `Not on ${(c.dates || []).map((d) => formatShortDate(dateFromKey(d))).join(", ")}`;
    default:
      return "Repeat changed";
  }
}

function changedAgo(at: string) {
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function renderChanges() {
  el.changes.innerHTML = "";
  const cutoff = Date.now() - CHANGES_DAYS * 86400000;
  const seen = new Set<string>();
  const relevant = changes
    .filter((c) => toggleState[c.calendar] && new Date(c.at).getTime() >= cutoff)
    .filter((c) => {
      // A year group's event is logged once per class; show it once.
      const key = `${c.uid}|${c.kind}|${c.start}|${(c.dates || []).join()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  el.changes.hidden = relevant.length === 0;
  if (!relevant.length) return;

  const head = Object.assign(document.createElement("div"), { className: "cal-changes-head" });
  head.append(Object.assign(document.createElement("span"), { className: "cal-strip-label", textContent: "Recently changed" }));
  const list = Object.assign(document.createElement("ul"), { className: "cal-changes-list" });
  for (const c of showAllChanges ? relevant : relevant.slice(0, CHANGES_SHOWN)) {
    const cal = ALL_CALENDARS.find((x) => x.code === c.calendar);
    const key = c.start.slice(0, 10);
    const dayEvents = (dayIndex.get(key) || []).filter((inst) => toggleState[inst.code]);
    const canOpen = (c.kind === "added" || c.kind === "moved") && dayEvents.length > 0;
    const row = document.createElement(canOpen ? "button" : "div");
    row.className = "cal-change";
    if (row instanceof HTMLButtonElement) {
      row.type = "button";
      row.addEventListener("click", () => openDayDialog(dateFromKey(key), dayEvents));
    }
    if (cal) row.style.setProperty("--dot-color", chipBackground(cal.colorVar));
    const title = Object.assign(document.createElement("span"), { className: "cal-change-title", textContent: c.title });
    if (c.kind === "cancelled") title.classList.add("is-cancelled");
    const text = Object.assign(document.createElement("span"), { className: "cal-change-text" });
    text.append(title, Object.assign(document.createElement("span"), { className: "cal-change-what", textContent: changeText(c) }));
    row.append(
      Object.assign(document.createElement("span"), { className: "cal-list-dot" }),
      text,
      Object.assign(document.createElement("span"), { className: "cal-change-when", textContent: changedAgo(c.at) })
    );
    const li = document.createElement("li");
    li.append(row);
    list.append(li);
  }
  el.changes.append(head, list);

  const foot = Object.assign(document.createElement("div"), { className: "cal-changes-foot" });
  foot.append(
    Object.assign(document.createElement("p"), {
      className: "cal-changes-note",
      textContent: "Already in your calendar app if you've subscribed - though Google Calendar can take up to a day to catch up.",
    })
  );
  if (relevant.length > CHANGES_SHOWN) {
    const toggle = Object.assign(document.createElement("button"), {
      type: "button",
      className: "cal-changes-more",
      textContent: showAllChanges ? "Show fewer" : `Show all ${relevant.length}`,
    });
    toggle.addEventListener("click", () => {
      showAllChanges = !showAllChanges;
      renderChanges();
    });
    foot.append(toggle);
  }
  el.changes.append(foot);
}

// --- Print ---

// On paper (the Print button, or the browser's own Print): the List view from
// today to the end of term - or 12 weeks, if no end of term is published - for
// the ticked calendars, under a heading saying which. The page goes back to
// how it was afterwards.
let beforePrint: { view: View; weeks: number } | null = null;

function preparePrint() {
  if (beforePrint) return;
  beforePrint = { view: currentView, weeks: listWeeks };
  const end = termEndKey();
  const days = end ? daysFromToday(end) + 1 : 12 * 7;
  listWeeks = Math.max(1, Math.ceil(days / 7));
  currentView = "list";
  const names = selectedCalendars().map((cal) => cal.label).join(", ");
  const until = end ? formatShortDate(dateFromKey(end)) : formatShortDate(addDays(TODAY, listWeeks * 7 - 1));
  el.printHeading.textContent = `St Paul's ${names ? `— ${names} ` : ""}· ${formatShortDate(TODAY)} to ${until}`;
  render();
}

function restoreAfterPrint() {
  if (!beforePrint) return;
  currentView = beforePrint.view;
  listWeeks = beforePrint.weeks;
  beforePrint = null;
  render();
}

function handlePrint() {
  preparePrint();
  window.print();
}

// --- Share these calendars ---

// Shown once a parent has ticked something beyond the defaults: a link that
// ticks the same calendars for whoever opens it (see applyLinkedCalendars).
function shareSelectionUrl() {
  const codes = selectedCalendars().filter((cal) => !DEFAULT_ON.has(cal.code)).map((cal) => cal.code);
  const url = new URL(window.location.pathname, window.location.origin);
  if (codes.length) url.search = `?c=${codes.join(",")}`;
  return url.href;
}

function renderShareSelection() {
  el.shareButton.hidden = !selectedCalendars().some((cal) => !DEFAULT_ON.has(cal.code));
  el.shareStatus.textContent = "";
}

async function handleShareSelection() {
  const url = shareSelectionUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "St Paul's calendars", text: "Our school calendars - tap to add them to your phone's calendar:", url });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    el.shareStatus.textContent = "Link copied ✓";
  } catch {
    el.shareStatus.textContent = url;
  }
}

// What the previous/next buttons step by, for their labels.
const VIEW_UNIT: Record<View, string> = { list: "", month: "month", week: "week", day: "day" };

function render() {
  el.grid.hidden = currentView === "list" || currentView === "day";
  el.dayAgenda.hidden = currentView !== "day";
  el.list.hidden = currentView !== "list";
  // The List view always starts today, so there's nothing to step through.
  el.navDates.hidden = currentView === "list";
  el.prevButton.setAttribute("aria-label", `Previous ${VIEW_UNIT[currentView]}`);
  el.nextButton.setAttribute("aria-label", `Next ${VIEW_UNIT[currentView]}`);
  if (currentView === "list") {
    el.monthLabel.textContent = "Coming up";
    renderList();
  } else if (currentView === "month") {
    el.monthLabel.textContent = MONTH_LABEL_FMT.format(viewedDate);
    renderMonthGrid();
  } else if (currentView === "week") {
    el.monthLabel.textContent = formatWeekLabel(viewedDate);
    renderWeekGrid();
  } else {
    el.monthLabel.textContent = formatDayLabel(viewedDate);
    renderDayAgenda();
  }
  renderLegend();
  renderDayOff();
  renderChanges();
}

// One event: time column, then title / calendar / location / description / link, with
// a bar in the calendar's colour down the left. Shared by the day dialog and
// the Day view agenda.
function renderEventRow(inst: Instance) {
  const row = document.createElement("article");
  row.className = "day-event";
  row.style.setProperty("--event-color", chipBackground(inst.colorVar));

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

function openDayDialog(date: Date, dayEvents: Instance[]) {
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
  if (currentView === "list") return true;
  if (currentView === "month") {
    return TODAY.getFullYear() === viewedDate.getFullYear() && TODAY.getMonth() === viewedDate.getMonth();
  }
  if (currentView === "week") {
    return TODAY >= viewedDate && TODAY < addDays(viewedDate, 7);
  }
  return londonDateKey(TODAY) === londonDateKey(viewedDate);
}

function switchView(newView: View) {
  if (newView === currentView) return;
  const referenceDate = isTodayInView() ? TODAY : viewedDate;
  viewedDate = normalizeAnchor(referenceDate, newView === "list" ? "day" : newView);
  currentView = newView;
  saveView(currentView);
  updateViewButtonStyles();
  render();
}

// "How to show them" and other links to a Help question open its answer.
function openHelpFromLinks() {
  const open = () => {
    const target = window.location.hash && document.getElementById(window.location.hash.slice(1));
    if (target instanceof HTMLDetailsElement) target.open = true;
  };
  window.addEventListener("hashchange", open);
  // The same link tapped twice changes no hash, so open on the tap too.
  document.addEventListener("click", (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    const target = link && document.getElementById(link.hash.slice(1));
    if (target instanceof HTMLDetailsElement) target.open = true;
  });
  open();
}

function shiftAnchor(delta: number) {
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
  const allInstances: Instance[] = [];
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
  el.refreshButton.classList.add("is-busy");
  el.refreshButton.setAttribute("aria-label", "Refreshing events");
  el.error.hidden = true;

  const [{ failures }] = await Promise.all([loadAllCalendarData(), loadChanges()]);

  el.refreshButton.disabled = false;
  el.refreshButton.classList.remove("is-busy");
  el.refreshButton.setAttribute("aria-label", "Refresh events");

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
  renderPickHint();
  renderComingSoon();
  renderPlatformChoice();
  renderAddActions();
  renderIcsLinks();
  renderShareSelection();
  updateViewButtonStyles();
  openHelpFromLinks();

  el.prevButton.addEventListener("click", () => shiftAnchor(-1));
  el.nextButton.addEventListener("click", () => shiftAnchor(1));
  el.todayButton.addEventListener("click", () => {
    viewedDate = normalizeAnchor(TODAY, currentView);
    render();
  });
  el.refreshButton.addEventListener("click", handleRefresh);
  el.printButton.addEventListener("click", handlePrint);
  window.addEventListener("beforeprint", preparePrint);
  window.addEventListener("afterprint", restoreAfterPrint);
  el.shareButton.addEventListener("click", handleShareSelection);
  // Delegated, since renderAddActions() rebuilds these links on every tick.
  for (const container of [el.addList, el.icsLinks]) {
    container.addEventListener("click", countClick);
  }
  // A phone turned to landscape, or a window narrowed, past the point where
  // Week makes sense: go to List.
  NARROW.addEventListener("change", () => {
    if (NARROW.matches && currentView === "week") switchView("list");
  });
  for (const btn of el.viewButtons) {
    btn.addEventListener("click", () => switchView(btn.dataset.view as View));
  }
  el.dialogClose.addEventListener("click", () => el.dialog.close());
  // A click on the backdrop lands on the <dialog> itself, not on its
  // content, so this closes it without a wrapper element.
  el.dialog.addEventListener("click", (e) => {
    if (e.target === el.dialog) el.dialog.close();
  });

  const [{ failures }] = await Promise.all([loadAllCalendarData(), loadChanges()]);
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
