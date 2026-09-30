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
