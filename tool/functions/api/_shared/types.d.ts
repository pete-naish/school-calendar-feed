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
}

// One entry in data/manual_events/<file>.json.
export interface ManualEvent extends EventFields {
  id: string;
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
}

export interface ParseResponse {
  events: EventFields[];
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
}

export interface UpdateResponse {
  updated: true;
  rebuild_triggered: boolean;
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
