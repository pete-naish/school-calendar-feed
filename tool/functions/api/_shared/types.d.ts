// Shapes shared across the API, and with the tool's page (app.ts imports these
// as types only, so nothing here may depend on the Workers runtime - that's
// env.ts). Dates are "YYYY-MM-DD" and times "HH:MM" (Europe/London)
// throughout.

// What a request body is before anything has checked it.
export type RequestBody = Record<string, unknown>;

export interface ClassEntry {
  code: string;
  label: string;
}

export interface YearGroup {
  key: string;
  label: string;
  classes: ClassEntry[];
}

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY";

export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number;
  until: string;
}

// `classes` scopes an exception on a year group's shared event to some of its
// classes (see validate.ts).
export type EventException =
  | { date: string; action: "cancelled"; classes?: string[] }
  | {
      date: string;
      action: "moved";
      new_date: string;
      new_time: string | null;
      new_end_time: string | null;
      classes?: string[];
    };

// A manual event as validate.ts leaves it - what the page sends back to save.
export interface EventFields {
  title: string;
  date: string;
  end_date: string | null;
  time: string | null;
  end_time: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  recurrence: Recurrence | null;
  exceptions: EventException[];
  // A poster's key in the POSTERS bucket (see posters.ts). Absent on events
  // saved before posters existed.
  image?: string | null;
  // On a multi-day event with a start time: true when its times apply on each
  // of its days (19:00-22:00 on Tuesday and on Wednesday), rather than one
  // stretch from the first day's start to the last day's end. Saved only when
  // true. From the model: true, false, or null when it couldn't tell (the rep
  // is asked).
  each_day?: boolean | null;
  // On a multi-day all-day event that doesn't repeat: true when it's a
  // drop-off window (coat donations any day 2-20 Nov), published as its first
  // and last days only rather than across every day (see build_manual_event()
  // in scripts/build_ics.py). Saved only when true; from the model as for
  // `each_day`.
  window?: boolean | null;
}

// One entry in data/manual_events/<file>.json. `rev` changes on every save
// (see generateRev() in github.ts); absent on an event that predates it.
export interface ManualEvent extends EventFields {
  id: string;
  rev?: string;
}

// A date correction's dates/times as event fields (see schoolEventCorrections.ts).
export interface SpanFields {
  date?: string;
  end_date?: string;
  time?: string | null;
  end_time?: string | null;
}

// An event from the school's own feed, read back from a published .ics (see
// wholeSchool.ts), with any saved override and correction laid over it.
export interface SchoolEvent {
  id: string;
  title: string;
  date: string;
  end_date: string;
  time: string | null;
  end_time: string | null;
  description: string;
  location: string;
  image: string | null;
  // The version stamp of its description/location/poster override, if any.
  rev?: string;
  correction?: { note: string; school: SpanFields | null };
}

// POST /api/events-list, for a class: its own and year-shared manual events
// plus the school events routed to it (flagged `school_event`, and
// `year_group` when the sibling class has them too).
export type ClassListedEvent =
  | (ManualEvent & { year_group?: true; school_event?: undefined })
  | (SchoolEvent & { school_event: true; year_group: boolean });

export type PersonalDetailKind = "mobile" | "email" | "whatsapp";

export interface PersonalDetail {
  field: "title" | "description" | "location";
  kind: PersonalDetailKind;
  text: string;
  index?: number;
}

// Every error code an endpoint can answer with.
export type ApiErrorCode =
  | "invalid_json"
  | "invalid_calendar"
  | "invalid_passcode"
  | "rate_limited"
  | "not_allowed"
  | "empty_text"
  | "extraction_failed"
  | "no_events"
  | "too_many_events"
  | "validation_failed"
  | "confirm_public"
  | "commit_failed"
  | "list_failed"
  | "not_found"
  | "file_full"
  | "invalid_id"
  | "missing_id"
  | "nothing_to_update"
  | "invalid_week"
  | "not_available"
  | "server_error";

// Any endpoint's error body. `message` is shown to the rep when present.
export interface ApiError {
  error: ApiErrorCode;
  message?: string;
  findings?: PersonalDetail[];
  errors?: { index: number; error: string }[];
}

export interface CalendarsResponse {
  yearGroups: YearGroup[];
  // Whether events can have posters (the POSTERS bucket is bound).
  posters: boolean;
}

export interface PosterUploadResponse {
  image: string;
}

// The event already in the calendar that an extracted one repeats (see
// duplicates.ts). Shown to the rep, never saved.
export interface AlreadyListed {
  title: string;
  date: string;
  end_date: string;
  time: string | null;
  end_time: string | null;
  source: "whole_school" | "class" | "year_group";
}

export type ParsedEvent = EventFields & { already_listed?: AlreadyListed };

export interface ParseResponse {
  events: ParsedEvent[];
  warnings: string[];
}

export interface SaveResponse {
  saved: number;
  skipped_duplicates: number;
  commit_sha?: string;
  rebuild_triggered: boolean;
}

// A class calendar gets ClassListedEvent[]; Whole School just the school's own
// events, unflagged.
export interface ListResponse {
  events: ClassListedEvent[] | SchoolEvent[];
  // "Last Day of ... Term" dates, earliest first (not for Whole School).
  term_ends?: string[];
}

export interface UpdateResponse {
  updated: true;
  rebuild_triggered: boolean;
  // The event's new version stamp (see generateRev() in github.ts).
  rev?: string;
}

// GET /api/event-ready: whether an event's page on the public site (and so its
// link preview) shows its latest save.
export interface EventReadyResponse {
  ready: boolean;
}

export interface DeleteResponse {
  deleted: true;
  rebuild_triggered: boolean;
}

export interface WeekResponse {
  week_start: string;
  week_end: string;
  text: string;
  count: number;
}

// POST /api/stats: this calendar's subscribe clicks on the public page (see
// _shared/clickStats.ts). `available` is false when the STATS binding isn't
// set up, and the counts are then all 0.
export interface StatsResponse {
  available: boolean;
  total: number;
  this_month: number;
  by_platform: Record<"apple" | "google" | "outlook" | "link", number>;
}

// What the page may count through POST /api/track - kept in step with
// PAGE_ACTIONS in usageStats.ts (the tests check).
export type PageAction =
  | "week_copy"
  | "share_link_copy"
  | "share_message_copy"
  | "qr_download"
  | "manual_add"
  | "add_anyway"
  | "event_copy"
  | "event_share";
