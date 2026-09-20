// Persists description/location overrides for whole-school events (see
// calendars.js's WHOLE_SCHOOL entry) to data/whole_school_overrides.json -
// {"<school event id>": {"description": "...", "location": "..."}}, either
// key optional - which scripts/build_ics.py applies in place of the
// school's own description (and as the LOCATION the school's feed never
// has) on every build.
import { commitJsonFile } from "./github.js";

const OVERRIDES_PATH = "data/whole_school_overrides.json";
const FIELDS = ["description", "location"];

// One entry as {description?, location?}. An older entry was a bare string
// (the description) - still read, and rewritten in the object form the next
// time that event is saved. Mirrors _normalize_override() in
// scripts/build_ics.py.
export function normalizeOverride(value) {
  if (typeof value === "string") return { description: value };
  if (!value || typeof value !== "object") return {};
  const override = {};
  for (const field of FIELDS) {
    if (typeof value[field] === "string") override[field] = value[field];
  }
  return override;
}

// `changes` holds only the fields being edited - {description?, location?} -
// and any field it leaves out keeps whatever is already stored, so saving a
// location doesn't also pin the description to the school's current text.
// A blank value removes that field's override rather than storing "": that
// reverts the description to whatever the school's own feed says (storing ""
// would instead force it permanently blank even if the school's text later
// changes, which isn't what clearing the box means), and leaves the event
// with no location. An entry with no fields left is dropped entirely.
export async function commitWholeSchoolOverride(env, id, changes) {
  return commitJsonFile(
    env,
    OVERRIDES_PATH,
    {},
    async (overrides) => {
      const updated = { ...overrides };
      const entry = normalizeOverride(updated[id]);
      for (const field of FIELDS) {
        if (typeof changes[field] !== "string") continue;
        if (changes[field]) {
          entry[field] = changes[field];
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
    `Update Whole School event (${id})`
  );
}
