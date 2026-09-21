// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPasscode, timingSafeEqual } from "../functions/api/_shared/auth.js";

const env = { CLASS_PASSWORDS: JSON.stringify({ "y5-b": "correct horse", "rec-a": "pässwörd-🐴", empty: "", num: 12345 }) };

test("timingSafeEqual: equal strings match, anything else doesn't", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("pässwörd-🐴", "pässwörd-🐴"), true);
  for (const [a, b] of [
    ["abc", "abd"],
    ["abc", "ab"], // a prefix of the real one
    ["ab", "abc"], // longer than the real one
    ["abc", "abcd"],
    ["abc", ""],
    ["", "abc"],
    ["abc", "ABC"],
    ["a\u0000", "a"], // a trailing NUL isn't the same as the padding
    ["a", "a\u0000\u0000"],
    ["é", "é"], // same-looking text, different bytes
  ]) {
    assert.equal(timingSafeEqual(a, b), false, JSON.stringify([a, b]));
  }
});

test("the right passcode for the right calendar is accepted", () => {
  assert.equal(checkPasscode(env, "y5-b", "correct horse"), true);
  assert.equal(checkPasscode(env, "rec-a", "pässwörd-🐴"), true);
});

test("a wrong, partial, longer, differently-cased or another calendar's passcode is refused", () => {
  for (const guess of ["wrong", "correct hors", "correct horse!", "Correct Horse", " correct horse", "correct horse "]) {
    assert.equal(checkPasscode(env, "y5-b", guess), false, guess);
  }
  assert.equal(checkPasscode(env, "rec-a", "correct horse"), false);
});

test("a missing, empty or non-string passcode is refused", () => {
  for (const guess of [undefined, null, "", 12345, ["correct horse"], { toString: () => "correct horse" }]) {
    assert.equal(checkPasscode(env, "y5-b", guess), false, JSON.stringify(guess));
  }
});

test("a calendar with no passcode configured can't be opened, whatever is sent", () => {
  assert.equal(checkPasscode(env, "fosps", "anything"), false); // not in the secret at all
  assert.equal(checkPasscode(env, "empty", "anything"), false); // configured as ""
  assert.equal(checkPasscode(env, "empty", ""), false);
  assert.equal(checkPasscode(env, "num", "12345"), false); // not a string in the secret
  assert.equal(checkPasscode(env, "__proto__", "anything"), false);
  assert.equal(checkPasscode(env, "constructor", "anything"), false);
});

test("a CLASS_PASSWORDS secret that isn't JSON is an error, not a silent refusal", () => {
  assert.throws(() => checkPasscode({ CLASS_PASSWORDS: "not json" }, "y5-b", "x"), /not valid JSON/);
  assert.throws(() => checkPasscode({}, "y5-b", "x"), /not valid JSON/);
});
