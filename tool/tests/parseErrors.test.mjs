// Run with: node --test tool/tests/
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as parse } from "../functions/api/parse.js";

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
let logged;
beforeEach(() => {
  logged = [];
  console.error = (...args) => logged.push(args.join(" "));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

const env = { ANTHROPIC_API_KEY: "sk-ant-secret", CLASS_PASSWORDS: JSON.stringify({ "5hp": "pw" }) };
const extract = () =>
  parse({
    request: new Request("https://x/api/parse", {
      method: "POST",
      body: JSON.stringify({ calendar: "5hp", passcode: "pw", text: "Bake sale on 2026-10-01" }),
    }),
    env,
  });

const GENERIC = /try again in a moment/;

test("an Anthropic error body is logged, not sent to the rep", async () => {
  const upstream = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"},"request_id":"req_011CS"}';
  globalThis.fetch = async () => new Response(upstream, { status: 400 });
  const resp = await extract();
  assert.equal(resp.status, 502);
  const text = await resp.text();
  assert.match(JSON.parse(text).message, GENERIC);
  assert.equal(JSON.parse(text).error, "extraction_failed");
  assert.doesNotMatch(text, /credit balance|req_011CS|invalid_request/);
  assert.ok(logged.some((line) => line.includes("credit balance") && line.includes("400")), "detail should still reach the log");
});

test("a network failure's text is logged, not sent to the rep", async () => {
  globalThis.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.anthropic.com (internal-proxy-7)");
  };
  const resp = await extract();
  assert.equal(resp.status, 502);
  const text = await resp.text();
  assert.match(JSON.parse(text).message, GENERIC);
  assert.doesNotMatch(text, /ENOTFOUND|internal-proxy/);
  assert.ok(logged.some((line) => line.includes("ENOTFOUND")));
});

test("a response with no events tool call gets the same generic message", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry" }] }), { status: 200 });
  const resp = await extract();
  assert.equal(resp.status, 502);
  assert.match((await resp.json()).message, /Couldn't extract events|try again/);

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "something_else", input: {} }] }), { status: 200 });
  const second = await extract();
  const body = await second.json();
  assert.match(body.message, GENERIC);
  assert.doesNotMatch(body.message, /Model|tool_use/);
});

test("a good extraction still comes back with its events", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "record_events", input: { events: [{ title: "bake sale", date: "2026-10-01" }] } }],
      }),
      { status: 200 }
    );
  const resp = await extract();
  assert.equal(resp.status, 200);
  const { events } = await resp.json();
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Bake Sale");
  assert.deepEqual(logged, []);
});
