// The rep tool page's helpers that don't touch the page itself, in their own
// module so the tests can import them (tool/tests/appConfirm.test.mjs,
// pastEvents.test.mjs). app.ts is everything else.
import type { ApiError, EventException } from "./functions/api/_shared/types.d.ts";

// What apiCall() in app.ts resolves to. `data` is null when the body wasn't
// JSON; a successful call's body is taken to be what the endpoint promises.
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: ApiError | null };

// The server answers 409 "confirm_public" when the text looks like it holds
// personal contact details (a mobile number, a personal email...): events are
// public and permanent. Its message says what it found, and the save button
// becomes "Save anyway" - pressing it sends the same save again with
// confirm_public. Any edit inside `watch` takes the confirmation back, since the
// text may now hold something else. `label` is what the button normally says -
// passed in, because by the time the server answers the button says "Saving…".
// See functions/api/_shared/personalDetails.ts.
export function isConfirmPublic(
  resp: ApiResult<unknown>
): resp is { ok: false; status: 409; data: ApiError & { error: "confirm_public" } } {
  return resp.status === 409 && Boolean(resp.data) && (resp.data as ApiError).error === "confirm_public";
}

export function armPublicConfirm(
  button: HTMLElement,
  label: string,
  errorEl: HTMLElement,
  message: string | undefined,
  watch: EventTarget
) {
  button.dataset.label = label;
  button.dataset.confirmPublic = "1";
  button.textContent = "Save anyway";
  errorEl.textContent = message ?? "";
  errorEl.hidden = false;
  watch.addEventListener(
    "input",
    () => {
      disarmPublicConfirm(button);
      errorEl.hidden = true;
    },
    { once: true }
  );
}

export function disarmPublicConfirm(button: HTMLElement) {
  if (button.dataset.label) button.textContent = button.dataset.label;
  delete button.dataset.label;
  delete button.dataset.confirmPublic;
}

// Spread into a save request's body: confirms it if the button is armed.
export function confirmPublicField(button: HTMLElement): { confirm_public?: true } {
  return button.dataset.confirmPublic === "1" ? { confirm_public: true } : {};
}

// Anything listed with a date: a saved manual event or a school one.
export interface Dated {
  date: string;
  end_date?: string | null;
  recurrence?: { until: string | null } | null;
  exceptions?: EventException[];
}

// The last day an event touches: its end date, a repeat's until date, or a
// moved occurrence's new date, whichever is latest. ISO dates compare as
// strings.
export function eventLastDay(event: Dated): string {
  const days = [event.date, event.end_date, event.recurrence && event.recurrence.until];
  for (const exc of event.exceptions || []) {
    if (exc.action === "moved") days.push(exc.new_date);
  }
  return days.filter((day): day is string => Boolean(day)).reduce((a, b) => (b > a ? b : a));
}

// Past once its last day is over - so a weekly series stays upcoming until
// its final occurrence, and a trip until its last day.
export function isPastEvent(event: Dated, today: string) {
  return eventLastDay(event) < today;
}

// Whether `date` is a day a series starting on `start` repeats on - the same
// rule as isOccurrence() in functions/api/_shared/validate.ts, which the
// server checks every exception against. Keep the two in step
// (tests/occurrence.test.mjs compares them).
export function isOccurrence(date: string, start: string, recurrence: { freq: string; interval: number; until: string }) {
  if (date < start || date > recurrence.until) return false;
  if (recurrence.freq === "MONTHLY") {
    const months = (Number(date.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(start.slice(5, 7));
    return date.slice(8) === start.slice(8) && months % recurrence.interval === 0;
  }
  const step = recurrence.freq === "WEEKLY" ? 7 * recurrence.interval : recurrence.interval;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  return days % step === 0;
}

// A repeating event's `i`th regular day after its first (0: the first), or
// null when that month has no such day (a monthly series from the 31st).
function nthOccurrence(start: string, freq: string, interval: number, i: number): string | null {
  const d = new Date(`${start}T00:00:00Z`);
  if (freq === "MONTHLY") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + i * interval);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (day > lastDay) return null;
    d.setUTCDate(day);
  } else {
    d.setUTCDate(d.getUTCDate() + i * interval * (freq === "WEEKLY" ? 7 : 1));
  }
  return d.toISOString().slice(0, 10);
}

// The day the event list shows a repeating event under: the first day on or
// after `today` it happens - its own days less the ones cancelled or moved
// away, plus the days moved to - so a weekly PE that began in September
// shows next Thursday, not its first one. For `calendar`, an exception limited
// to other classes doesn't count. Anything that doesn't repeat (or has no day
// left) shows its first day. Closure days the build skips (half term etc.)
// aren't known here, so one of those can be shown.
export function nextOccurrence(
  event: Dated & { recurrence?: { freq?: string; interval?: number; until: string | null } | null },
  today: string,
  calendar: string | null = null
): string {
  const r = event.recurrence;
  if (!r || !r.freq || !r.until) return event.date;
  const applying = (event.exceptions || []).filter(
    (exc) => !exc.classes || exc.classes.length === 0 || (calendar !== null && exc.classes.includes(calendar))
  );
  const away = new Set(applying.map((exc) => exc.date));
  let next: string | null = null;
  for (const exc of applying) {
    if (exc.action === "moved" && exc.new_date >= today && (!next || exc.new_date < next)) next = exc.new_date;
  }
  // Every repeat is capped at 400 days (validate.ts), so 1000 steps covers it.
  for (let i = 0; i < 1000; i++) {
    const day = nthOccurrence(event.date, r.freq, r.interval || 1, i);
    if (day === null) continue;
    if (day > r.until || (next && day >= next)) break;
    if (day >= today && !away.has(day)) {
      next = day;
      break;
    }
  }
  return next ?? event.date;
}
