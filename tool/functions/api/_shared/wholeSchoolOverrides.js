// Persists description overrides for whole-school events (see
// calendars.js's WHOLE_SCHOOL entry) to data/whole_school_overrides.json -
// {"<school event id>": "override text"} - which scripts/build_ics.py
// applies in place of the school's own description on every build.
import { commitJsonFile } from "./github.js";

const OVERRIDES_PATH = "data/whole_school_overrides.json";

// An empty/blank description removes the override entirely (reverting to
// whatever the school's own feed says) rather than storing "" - storing ""
// would instead force the description permanently blank even if the
// school's own text later changes, which isn't what clearing the box means.
export async function commitWholeSchoolDescription(env, id, description) {
  return commitJsonFile(
    env,
    OVERRIDES_PATH,
    {},
    async (overrides) => {
      const updated = { ...overrides };
      if (description) {
        updated[id] = description;
      } else {
        delete updated[id];
      }
      return { data: updated };
    },
    `Update Whole School event description (${id})`
  );
}
