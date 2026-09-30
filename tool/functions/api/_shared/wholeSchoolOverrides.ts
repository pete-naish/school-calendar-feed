// Persists description/location overrides for school-sourced events - whole-
// school ones (see calendars.js's WHOLE_SCHOOL entry) and the ones listed in a
// class's own calendar - to data/whole_school_overrides.json -
// {"<school event id>": {"description": "...", "location": "..."}}, either
// key optional - which scripts/build_ics.py applies in place of the
// school's own description (and as the LOCATION the school's feed never
// has) on every build.
import { commitJsonFile } from "./github.ts";
import type { Env } from "./env.ts";

export type Override = { description?: string; location?: string };

// The file as read: entries are checked by normalizeOverride().
export type OverridesFile = Record<string, unknown>;

const OVERRIDES_PATH = "data/whole_school_overrides.json";

// A school event's id is the school API's own numeric one (see the UID in
// wholeSchool.js). Nothing else may become a key in the overrides file.
const SCHOOL_EVENT_ID = /^\d{1,12}$/;

export function isSchoolEventId(id: unknown): id is string {
  return typeof id === "string" && SCHOOL_EVENT_ID.test(id);
}
const FIELDS = ["description", "location"] as const;

// One entry as {description?, location?}. An older entry was a bare string
// (the description) - still read, and rewritten in the object form the next
// time that event is saved. Mirrors _normalize_override() in
// scripts/build_ics.py.
export function normalizeOverride(value: unknown): Override {
  if (typeof value === "string") return { description: value };
  if (!value || typeof value !== "object") return {};
  const fields = value as Record<string, unknown>;
  const override: Override = {};
  for (const field of FIELDS) {
    const text = fields[field];
    if (typeof text === "string") override[field] = text;
  }
  return override;
}

// The events with any saved override laid over them. A pending override
// (saved but not yet picked up by the next 6-hourly build) takes precedence
// over what's currently published, so a rep who just saved doesn't see their
// own edit vanish.
export function applyOverrides<E extends { id: string; description: string; location: string }>(
  events: E[],
  overrides: OverridesFile
): E[] {
  return events.map((e) => {
    const override = normalizeOverride(overrides[e.id]);
    return {
      ...e,
      description: override.description ?? e.description,
      location: override.location ?? e.location,
    };
  });
}

// `changes` holds only the fields being edited - {description?, location?} -
// and any field it leaves out keeps whatever is already stored, so saving a
// location doesn't also pin the description to the school's current text.
// A blank value removes that field's override rather than storing "": that
// reverts the description to whatever the school's own feed says (storing ""
// would instead force it permanently blank even if the school's text later
// changes, which isn't what clearing the box means), and leaves the event
// with no location. An entry with no fields left is dropped entirely.
export async function commitWholeSchoolOverride(env: Env, id: string, changes: Override, label = "Whole School event") {
  if (!isSchoolEventId(id)) return { error: "invalid_id" as const, message: "That isn't a school event id." };
  return commitJsonFile<OverridesFile>(
    env,
    OVERRIDES_PATH,
    {},
    async (overrides) => {
      const updated = { ...overrides };
      const entry = normalizeOverride(updated[id]);
      for (const field of FIELDS) {
        const value = changes[field];
        if (typeof value !== "string") continue;
        if (value) {
          entry[field] = value;
        } else {
          delete entry[field];
        }
      }
      if (Object.keys(entry).length > 0) {
        updated[id] = entry;
      } else {
        delete updated[id];
      }
      return { data: updated };
    },
    `Update ${label} (${id})`
  );
}
