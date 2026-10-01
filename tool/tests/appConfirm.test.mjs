// Run with: node --test tool/tests/
//
// The "Save anyway" button logic in appHelpers.ts, run against fake buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isConfirmPublic, armPublicConfirm, disarmPublicConfirm, confirmPublicField } from "../appHelpers.ts";

// The page's own code: app.ts and its modules in page/.
const pageDir = new URL("../page/", import.meta.url);
const source = [
  readFileSync(new URL("../app.ts", import.meta.url), "utf8"),
  ...readdirSync(pageDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(new URL(f, pageDir), "utf8")),
].join("\n");

// A button and its error line as the handlers see them; `watch` records the
// "input" listener so the test can fire it, as an edit to the card would.
const fixture = (text) => {
  const listeners = [];
  return {
    button: { dataset: {}, textContent: text },
    errorEl: { textContent: "", hidden: true },
    watch: {
      addEventListener: (type, fn, opts) => listeners.push({ type, fn, once: Boolean(opts && opts.once) }),
      edit() {
        for (const l of listeners.splice(0)) l.fn();
      },
      listeners,
    },
  };
};

test("isConfirmPublic is only a 409 whose error is confirm_public", () => {
  assert.equal(isConfirmPublic({ status: 409, data: { error: "confirm_public" } }), true);
  assert.equal(isConfirmPublic({ status: 409, data: { error: "file_full" } }), false);
  assert.equal(isConfirmPublic({ status: 400, data: { error: "confirm_public" } }), false);
  assert.equal(isConfirmPublic({ status: 409, data: null }), false);
  assert.equal(isConfirmPublic({ ok: true, status: 200, data: {} }), false);
});

test("arming shows the message, turns the button into Save anyway, and confirms the next save", () => {
  const { button, errorEl, watch } = fixture("Save changes");
  assert.deepEqual(confirmPublicField(button), {});
  armPublicConfirm(button, "Save changes", errorEl, "Ring 07700? Save anyway?", watch);
  assert.equal(button.textContent, "Save anyway");
  assert.equal(errorEl.textContent, "Ring 07700? Save anyway?");
  assert.equal(errorEl.hidden, false);
  assert.deepEqual(confirmPublicField(button), { confirm_public: true });
});

test("the label comes back as it was even though the button said 'Saving…' when the server answered", () => {
  // The saved-event and school-event handlers set "Saving…" before the call, so
  // that is what the button reads when the 409 arrives. Regression: the label
  // used to be taken from it, leaving the button stuck on "Saving…" afterwards.
  const { button, errorEl, watch } = fixture("Saving…");
  armPublicConfirm(button, "Save changes", errorEl, "msg", watch);
  disarmPublicConfirm(button);
  assert.equal(button.textContent, "Save changes");
  assert.deepEqual(confirmPublicField(button), {});
  assert.equal(button.dataset.label, undefined);
});

test("disarming leaves an unarmed button alone", () => {
  const { button } = fixture("Save all");
  disarmPublicConfirm(button);
  assert.equal(button.textContent, "Save all");
});

test("any edit takes the confirmation back and hides the message, once", () => {
  const { button, errorEl, watch } = fixture("Saving…");
  armPublicConfirm(button, "Save all", errorEl, "msg", watch);
  assert.equal(watch.listeners.length, 1);
  assert.equal(watch.listeners[0].type, "input");
  assert.equal(watch.listeners[0].once, true);
  watch.edit();
  assert.equal(button.textContent, "Save all");
  assert.equal(errorEl.hidden, true);
  assert.deepEqual(confirmPublicField(button), {});
});

test("it can be armed again after being disarmed, or re-armed while armed, without corrupting the label", () => {
  const { button, errorEl, watch } = fixture("Saving…");
  armPublicConfirm(button, "Save changes", errorEl, "one", watch);
  armPublicConfirm(button, "Save changes", errorEl, "two", watch); // e.g. a second 409 in a row
  assert.equal(button.dataset.label, "Save changes");
  disarmPublicConfirm(button);
  assert.equal(button.textContent, "Save changes");
  button.textContent = "Saving…";
  armPublicConfirm(button, "Save changes", errorEl, "three", watch);
  disarmPublicConfirm(button);
  assert.equal(button.textContent, "Save changes");
});

test("every call site passes the button's normal label", () => {
  const calls = [...source.matchAll(/\barmPublicConfirm\(([^;]*)\);/g)].map((m) => m[1].split(",").map((a) => a.trim()));
  assert.equal(calls.length, 3, "Save all, saved-event edit, school-event edit");
  for (const args of calls) assert.equal(args.length, 5, args.join(", "));
  assert.deepEqual(calls.map((a) => a[1]).sort(), ["originalText", "originalText", "saveAllLabel()"]);
});
