// Policy and helpers for the anonymous subscribe-click counters behind
// POST /api/subscribe-click (see ../subscribe-click.ts). The public landing
// page (docs/assets/calendar.ts) sends one beacon per subscribe link clicked;
// each bumps a monthly counter in env.STATS, a Workers KV binding.
//
// What's stored is only {month, calendar, platform} -> count: no IP, no user
// agent, no identifier of any kind. Both calendar and platform are checked
// against fixed lists, so the key space is bounded (16 calendars x 4
// platforms per month) whatever a caller sends.
import { isValidCalendar } from "./calendars.ts";

// Only beacons from the public page count. Anyone can forge this header
// outside a browser, so it's a junk filter, not protection - the counts are
// indicative, never exact (see tool/README.md's "Subscribe click counts").
export const STATS_ORIGIN = "https://calendar.nai.sh";

// "link" is a plain feed address under "Other apps" on the landing page.
export const PLATFORMS = ["apple", "google", "outlook", "link"];

export function isValidClick(calendar: unknown, platform: unknown): calendar is string {
  return isValidCalendar(calendar) && typeof platform === "string" && PLATFORMS.includes(platform);
}

// The first month anything was counted; the rep tool's Share tab adds up every
// month from here.
export const STATS_START = "2026-09";

// Months in UTC, which is close enough for a monthly tally.
export const monthOf = (now = new Date()) => now.toISOString().slice(0, 7);

// clicks:2026-09:rec-a:apple
export function clickKey(calendar: string, platform: string, now: Date | string = new Date()) {
  const month = typeof now === "string" ? now : monthOf(now);
  return `clicks:${month}:${calendar}:${platform}`;
}

// Every month from STATS_START to `now`'s, oldest first.
export function statsMonths(now = new Date()) {
  const months: string[] = [];
  const end = monthOf(now);
  let [y, m] = STATS_START.split("-").map(Number);
  for (let month = STATS_START; month <= end; month = `${y}-${String(m).padStart(2, "0")}`) {
    months.push(month);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return months;
}

export interface ClickTotals {
  total: number;
  this_month: number;
  by_platform: Record<string, number>;
}

// One calendar's clicks: all-time, this month, and all-time per platform.
export async function clickTotals(stats: KVNamespace, calendar: string, now = new Date()): Promise<ClickTotals> {
  const months = statsMonths(now);
  const current = monthOf(now);
  const cells = await Promise.all(
    months.flatMap((month) =>
      PLATFORMS.map(async (platform) => ({
        month,
        platform,
        count: Number.parseInt((await stats.get(clickKey(calendar, platform, month))) || "0", 10) || 0,
      }))
    )
  );
  const totals: ClickTotals = { total: 0, this_month: 0, by_platform: Object.fromEntries(PLATFORMS.map((p) => [p, 0])) };
  for (const { month, platform, count } of cells) {
    totals.total += count;
    totals.by_platform[platform] += count;
    if (month === current) totals.this_month += count;
  }
  return totals;
}
