// Weekly counts of what reps do in the tool, so Pete can see which parts get
// used: `usage:2026-W41:rec-a:parse = 4`, in env.STATS beside the subscribe
// click counts (see clickStats.ts), read in the Cloudflare dashboard.
//
// Like the click counts, only {week, calendar, action} -> count is stored: no
// IP, user agent, passcode or event content. Calendar and action are both
// checked against fixed lists, so the key space stays bounded.
//
// Most actions are counted by the endpoint that does them, after the passcode
// check and only once the action has worked. The few that never reach the
// server (copying the week's list, downloading the QR code...) are sent by
// the page to POST /api/track, which accepts only PAGE_ACTIONS.
//
// Best-effort, like rateLimit.ts: KV has no atomic increment, so two at once
// can count as one, and with no STATS binding nothing is counted.
import { isValidCalendar } from "./calendars.ts";
import type { Env } from "./env.ts";

export const SERVER_ACTIONS = [
  "open", // signed in, or the Events list reloaded
  "parse", // pressed Find events
  "parse_events", // + events Find events came back with
  "parse_duplicates", // + of those, marked "Already in the calendar"
  "save", // saved new events (one per save)
  "saved_events", // + events written
  "saved_year_shared", // + of those, for the whole year group
  "saved_recurring", // + of those, repeating
  "edit", // changed a saved event
  "exception_edit", // ... and that change touched its exceptions
  "school_edit", // a school event's description/location
  "date_correction", // a school event's date or time corrected
  "date_correction_undo", // ... or put back to the school's
  "delete",
  "confirm_public", // saved anyway after the personal details warning
  "week_view", // built a "What's on this week" list
  "share_view", // opened the Share tab
] as const;

export const PAGE_ACTIONS = [
  "week_copy", // Copy for WhatsApp, on the week's list
  "share_link_copy",
  "share_message_copy",
  "qr_download",
  "manual_add", // + Add a calendar event manually
  "add_anyway", // kept a draft marked "Already in the calendar"
] as const;

export type UsageAction = (typeof SERVER_ACTIONS)[number] | (typeof PAGE_ACTIONS)[number];
export type UsageCounts = Partial<Record<UsageAction, number>>;

const ALL_ACTIONS: readonly string[] = [...SERVER_ACTIONS, ...PAGE_ACTIONS];

export function isPageAction(action: unknown): action is (typeof PAGE_ACTIONS)[number] {
  return typeof action === "string" && (PAGE_ACTIONS as readonly string[]).includes(action);
}

const LONDON_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

// The ISO 8601 week (Monday-Sunday, week 1 holds the year's first Thursday)
// of `now` in London - so a Sunday-night save in BST still counts towards the
// week it was made in. e.g. "2026-W41".
export function isoWeek(now = new Date()) {
  const [y, m, d] = LONDON_DATE.format(now).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7; // Monday 1 ... Sunday 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // that week's Thursday
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function usageKey(calendar: string, action: string, now = new Date()) {
  return `usage:${isoWeek(now)}:${calendar}:${action}`;
}

// Adds each count (skipping zeros) to this week's counters for `calendar`.
// Never throws.
export async function bumpUsage(env: Env, calendar: string, counts: UsageCounts, now = new Date()) {
  const stats = env.STATS;
  if (!stats || !isValidCalendar(calendar)) return;
  await Promise.all(
    Object.entries(counts).map(async ([action, by]) => {
      if (!ALL_ACTIONS.includes(action) || !by || by < 0) return;
      try {
        const key = usageKey(calendar, action, now);
        const count = Number.parseInt((await stats.get(key)) || "0", 10) || 0;
        await stats.put(key, String(count + by));
      } catch (err) {
        console.error("usage count failed", err);
      }
    })
  );
}

// What an endpoint calls: off the response's critical path where the runtime
// allows (waitUntil), otherwise (the tests) awaited.
export async function recordUsage(
  ctx: { env: Env; waitUntil?: (promise: Promise<unknown>) => void },
  calendar: string,
  counts: UsageCounts
) {
  const work = bumpUsage(ctx.env, calendar, counts);
  if (ctx.waitUntil) ctx.waitUntil(work);
  else await work;
}
