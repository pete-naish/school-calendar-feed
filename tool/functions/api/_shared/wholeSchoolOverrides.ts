// Persists description/location/poster overrides for school-sourced events - whole-
// school ones (see calendars.ts's WHOLE_SCHOOL entry) and the ones listed in a
// class's own calendar - to data/whole_school_overrides.json -
// {"<school event id>": {"description": "...", "location": "..."}}, either
// key optional - which scripts/build_ics.py applies in place of the
// school's own description (and as the LOCATION the school's feed never
// has) on every build.
import { commitJsonFile, generateRev } from "./github.ts";
import { isPosterKey } from "./posters.ts";
import type { Env } from "./env.ts";

// `image` is a poster's key (see posters.ts). `rev` is the entry's version
// stamp, new on every save (generateRev() in github.ts) - not a field a rep
// edits, and an entry with nothing but a rev left is dropped.
export type Override = { description?: string; location?: string; image?: string; rev?: string };

// The file as read: entries are checked by normalizeOverride().
export type OverridesFile = Record<string, unknown>;

const OVERRIDES_PATH = "data/whole_school_overrides.json";

// A school event's id is the school API's own numeric one (see the UID in
// wholeSchool.ts). Nothing else may become a key in the overrides file.
const SCHOOL_EVENT_ID = /^\d{1,12}$/;

export function isSchoolEventId(id: unknown): id is string {
  return typeof id === "string" && SCHOOL_EVENT_ID.test(id);
}
const FIELDS = ["description", "location", "image"] as const;

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
    if (field === "image" && !isPosterKey(text)) continue;
    if (typeof text === "string") override[field] = text;
  }
  if (typeof fields.rev === "string" && Object.keys(override).length > 0) override.rev = fields.rev;
  return override;
}

// The events with any saved override laid over them. A pending override
// (saved but not yet picked up by the next 6-hourly build) takes precedence
// over what's currently published, so a rep who just saved doesn't see their
// own edit vanish.
export function applyOverrides<E extends { id: string; description: string; location: string; image: string | null }>(
  events: E[],
  overrides: OverridesFile
): E[] {
  return events.map((e) => {
    const override = normalizeOverride(overrides[e.id]);
    return {
      ...e,
      description: override.description ?? e.description,
      location: override.location ?? e.location,
      image: override.image ?? e.image,
      ...(override.rev && { rev: override.rev }),
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
//
// The result's `replacedImage` is the poster this change took off the event
// (replaced or removed), for the caller to delete, and `rev` the entry's new
// version stamp (null when the entry's gone).
export async function commitWholeSchoolOverride(env: Env, id: string, changes: Override, label = "Whole School event") {
  if (!isSchoolEventId(id)) return { error: "invalid_id" as const, message: "That isn't a school event id." };
  return commitJsonFile<OverridesFile, { replacedImage: string | null; rev: string | null }>(
    env,
    OVERRIDES_PATH,
    {},
    async (overrides) => {
      const updated = { ...overrides };
      const entry = normalizeOverride(updated[id]);
      const before = entry.image ?? null;
      delete entry.rev;
      for (const field of FIELDS) {
        const value = changes[field];
        if (typeof value !== "string") continue;
        if (value) {
          entry[field] = value;
        } else {
          delete entry[field];
        }
      }
      let rev: string | null = null;
      if (Object.keys(entry).length > 0) {
        rev = generateRev();
        updated[id] = { ...entry, rev };
      } else {
        delete updated[id];
      }
      const replacedImage = before && before !== entry.image ? before : null;
      return { data: updated, replacedImage, rev };
    },
    `Update ${label} (${id})`
  );
}
