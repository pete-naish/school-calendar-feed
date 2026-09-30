// Policy and helpers for the anonymous subscribe-click counters behind
// POST /api/subscribe-click (see ../subscribe-click.js). The public landing
// page (docs/assets/calendar.js) sends one beacon per subscribe link clicked;
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

// clicks:2026-09:rec-a:apple - months in UTC, which is close enough for a
// monthly tally.
export function clickKey(calendar: string, platform: string, now = new Date()) {
  return `clicks:${now.toISOString().slice(0, 7)}:${calendar}:${platform}`;
}
