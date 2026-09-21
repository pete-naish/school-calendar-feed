// Run with: node --test tool/tests/
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequest } from "../functions/api/_middleware.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// --- /api/* middleware ---

const realConsoleError = console.error;
afterEach(() => {
  console.error = realConsoleError;
});

test("every API response gets the no-store, nosniff and noindex headers, and is otherwise untouched", async () => {
  const resp = await onRequest({
    next: async () => new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json", "x-mine": "1" } }),
  });
  assert.equal(resp.status, 201);
  assert.equal(await resp.text(), '{"ok":true}');
  assert.equal(resp.headers.get("content-type"), "application/json");
  assert.equal(resp.headers.get("x-mine"), "1");
  assert.equal(resp.headers.get("cache-control"), "no-store");
  assert.equal(resp.headers.get("x-content-type-options"), "nosniff");
  assert.equal(resp.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("error responses get them too", async () => {
  const resp = await onRequest({ next: async () => new Response('{"error":"invalid_passcode"}', { status: 401 }) });
  assert.equal(resp.status, 401);
  assert.equal(resp.headers.get("cache-control"), "no-store");
});

test("an endpoint that throws becomes a generic JSON 500, with the detail logged, not sent", async () => {
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  const resp = await onRequest({
    next: async () => {
      throw new Error("CLASS_PASSWORDS secret is not valid JSON");
    },
  });
  assert.equal(resp.status, 500);
  assert.equal(resp.headers.get("content-type"), "application/json");
  assert.equal(resp.headers.get("cache-control"), "no-store");
  assert.equal(resp.headers.get("x-content-type-options"), "nosniff");
  const text = await resp.text();
  assert.equal(JSON.parse(text).error, "server_error");
  assert.doesNotMatch(text, /CLASS_PASSWORDS|JSON\b.*valid/);
  assert.ok(logged.some((line) => line.includes("CLASS_PASSWORDS")));
});

// --- _headers ---

// { "/*": { "X-Robots-Tag": "noindex, nofollow", ... } }
function parseHeadersFile(text) {
  const rules = {};
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      rules[current] = {};
    } else {
      const [name, ...value] = line.trim().split(":");
      rules[current][name.trim()] = value.join(":").trim();
    }
  }
  return rules;
}

const rules = parseHeadersFile(read("_headers"));
const all = rules["/*"];
const csp = Object.fromEntries(
  all["Content-Security-Policy"].split(";").map((part) => {
    const [directive, ...sources] = part.trim().split(/\s+/);
    return [directive, sources];
  })
);

test("_headers covers every path with the noindex, nosniff, no-framing and no-referrer headers", () => {
  assert.deepEqual(Object.keys(rules), ["/*"]);
  assert.equal(all["X-Robots-Tag"], "noindex, nofollow");
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.equal(all["X-Frame-Options"], "DENY");
  assert.equal(all["Referrer-Policy"], "no-referrer");
});

test("the CSP starts from nothing and allows only the tool's own script, style and API", () => {
  assert.deepEqual(csp["default-src"], ["'none'"]);
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["style-src"], ["'self'"]);
  assert.deepEqual(csp["connect-src"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'none'"]);
});

test("the CSP never allows inline code, eval, wildcards or another origin", () => {
  for (const [directive, sources] of Object.entries(csp)) {
    for (const source of sources) {
      assert.ok(["'none'", "'self'"].includes(source), `${directive} allows ${source}`);
    }
  }
});

// --- the page has to keep fitting that policy, or the tool silently breaks ---

const html = read("index.html");

test("index.html loads only its own script and stylesheet, with no inline script, style or handlers", () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const attrs of scripts) assert.match(attrs, /\bsrc="[^":/]+"/, `inline or remote script: <script ${attrs}>`);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /<(iframe|object|embed|form)\b/i);
  for (const [, href] of html.matchAll(/<link\b[^>]*\bhref="([^"]*)"/gi)) assert.doesNotMatch(href, /^(https?:)?\/\//, href);
  for (const [, src] of html.matchAll(/\bsrc="([^"]*)"/gi)) assert.doesNotMatch(src, /^(https?:)?\/\//, src);
});

test("app.js and style.css use nothing the CSP would block", () => {
  const js = read("app.js");
  assert.doesNotMatch(js, /\beval\s*\(|new Function\b|setTimeout\(\s*["'`]|setInterval\(\s*["'`]/);
  assert.doesNotMatch(js, /setAttribute\(\s*["']style["']|\.cssText\b|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(js, /innerHTML\s*=\s*[^"'\s;]/, "innerHTML may only be cleared");
  for (const [, url] of js.matchAll(/\bfetch\(\s*["'`]([^"'`]+)/g)) assert.match(url, /^\//, `fetch to ${url}`);
  const css = read("style.css");
  assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i);
});
