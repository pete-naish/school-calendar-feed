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

// Reads data/manual_events/<calendar>.json. A missing file (first submission
// for that calendar) is treated as an empty array, same as
// load_manual_events() in scripts/build_ics.py.
export async function getManualEventsFile(env, calendar) {
  const path = `data/manual_events/${calendar}.json`;
  const resp = await githubRequest(env, "GET", `/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
  if (resp.status === 404) {
    return { events: [], sha: null, path };
  }
  if (!resp.ok) {
    throw new Error(`GitHub GET failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const events = JSON.parse(base64DecodeUtf8(data.content));
  return { events, sha: data.sha, path };
}

async function putManualEventsFile(env, path, events, sha, message) {
  const content = base64EncodeUtf8(`${JSON.stringify(events, null, 2)}\n`);
  return githubRequest(env, "PUT", `/repos/${REPO}/contents/${path}`, {
    message: `${message} via class rep tool`,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
    committer: { name: "Class Rep Tool", email: "noreply@users.noreply.github.com" },
  });
}

export function generateEventId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function dedupeKey(calendar, title, date) {
  const input = `${calendar}|${title.trim().toLowerCase()}|${date}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// GET -> mutatorFn(currentEvents) -> PUT, with retry on a 409 sha conflict
// (another save landing between our GET and PUT). Backs every write path -
// save appends, update replaces-by-id, delete filters-by-id - each supplies
// only how the array should change via `mutatorFn`.
//
// `mutatorFn` is async and returns either `{ events, ...extra }` (the new
// array to write, plus anything the caller wants back, e.g. `saved` count)
// or `{ error: "not_found" }` to abort without writing.
export async function commitManualEvents(env, calendar, mutatorFn, commitMessage) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { events, sha, path } = await getManualEventsFile(env, calendar);
    const result = await mutatorFn(events);
    if (result.error) return result;

    const { events: newEvents, ...extra } = result;
    const resp = await putManualEventsFile(env, path, newEvents, sha, commitMessage);
    if (resp.ok) {
      const data = await resp.json();
      return { ...extra, commitSha: data.commit && data.commit.sha };
    }
    if (resp.status === 409 && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
      continue;
    }
    throw new Error(`GitHub PUT failed: ${resp.status} ${await resp.text()}`);
  }
  throw new Error("commitManualEvents: exhausted retries after repeated 409s");
}
