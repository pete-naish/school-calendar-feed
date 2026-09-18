const REPO = "pete-naish/school-calendar-feed";
const BRANCH = "main";
const API_BASE = "https://api.github.com";

// Workers runtime has no Node Buffer - base64 encode/decode by hand, UTF-8 safe.
function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRequest(env, method, path, body) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "school-calendar-feed-tool",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Reads and JSON-decodes an arbitrary repo file via the Contents API. A
// missing file is treated as `defaultValue` (e.g. a calendar's first-ever
// submission), same as the Python side's own missing-file handling.
export async function getJsonFile(env, path, defaultValue) {
  const resp = await githubRequest(env, "GET", `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (resp.status === 404) {
    return { data: defaultValue, sha: null, path };
  }
  if (!resp.ok) {
    throw new Error(`GitHub GET failed: ${resp.status} ${await resp.text()}`);
  }
  const body = await resp.json();
  return { data: JSON.parse(base64DecodeUtf8(body.content)), sha: body.sha, path };
}

async function putJsonFile(env, path, data, sha, message) {
  const content = base64EncodeUtf8(`${JSON.stringify(data, null, 2)}\n`);
  return githubRequest(env, "PUT", `/repos/${REPO}/contents/${path}`, {
    message: `${message} via class rep tool`,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
    committer: { name: "Class Rep Tool", email: "noreply@users.noreply.github.com" },
  });
}

// Reads data/manual_events/<calendar>.json. A missing file (first submission
// for that calendar) is treated as an empty array, same as
// load_manual_events() in scripts/build_ics.py.
export async function getManualEventsFile(env, calendar) {
  const { data, sha, path } = await getJsonFile(env, `data/manual_events/${calendar}.json`, []);
  return { events: data, sha, path };
}

export function generateEventId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function dedupeKey(calendar, title, date) {
  const input = `${calendar}|${title.trim().toLowerCase()}|${date}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_ATTEMPTS = 3;

function isRetryableStatus(status) {
  // 409: another save landed between our GET and PUT - re-fetch and retry.
  // 5xx: GitHub's problem, not the data's - a plain retry is likely to work.
  return status === 409 || status >= 500;
}

function backoff(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
}

// Retries any thrown error (network failure, GitHub 5xx via
// getManualEventsFile's own throw) up to MAX_ATTEMPTS - for read-only
// callers (events-list.js) that don't need commitManualEvents' GET+PUT
// cycle.
export async function retryable(fn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await backoff(attempt);
      }
    }
  }
  throw lastError;
}

// GET -> mutatorFn(currentData) -> PUT, retrying the whole cycle on a sha
// conflict, a GitHub 5xx, or a network-level failure (fetch() itself
// throwing) - not just the 409 case. Backs every write path against any
// JSON file in the repo (manual events, whole-school description overrides)
// - each caller supplies only how the data should change via `mutatorFn`.
//
// `mutatorFn` is async and returns either `{ data, ...extra }` (the new
// value to write, plus anything the caller wants back, e.g. `saved` count)
// or `{ error: "not_found" }` to abort without writing.
export async function commitJsonFile(env, path, defaultValue, mutatorFn, commitMessage) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { data, sha } = await getJsonFile(env, path, defaultValue);
      const result = await mutatorFn(data);
      if (result.error) return result;

      const { data: newData, ...extra } = result;
      const resp = await putJsonFile(env, path, newData, sha, commitMessage);
      if (resp.ok) {
        const body = await resp.json();
        return { ...extra, commitSha: body.commit && body.commit.sha };
      }
      const message = `GitHub PUT failed: ${resp.status} ${await resp.text()}`;
      if (isRetryableStatus(resp.status) && attempt < MAX_ATTEMPTS - 1) {
        lastError = new Error(message);
        await backoff(attempt);
        continue;
      }
      throw new Error(message);
    } catch (err) {
      // A GET that came back non-ok/non-404 (getJsonFile throws), or
      // fetch() itself rejecting (offline, DNS, timeout), lands here too -
      // worth a retry rather than an immediate surprise error for a
      // non-technical rep.
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await backoff(attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("commitJsonFile: exhausted retries");
}

// calendar-events-specific wrapper around commitJsonFile - keeps the
// `{ events, ...extra }` shape every existing caller (save/update/delete)
// already uses.
export async function commitManualEvents(env, calendar, mutatorFn, commitMessage) {
  return commitJsonFile(
    env,
    `data/manual_events/${calendar}.json`,
    [],
    async (events) => {
      const result = await mutatorFn(events);
      if (result.error) return result;
      const { events: newEvents, ...extra } = result;
      return { data: newEvents, ...extra };
    },
    commitMessage
  );
}
