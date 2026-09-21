// Run with: node --test tool/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_CONTACTS,
  describeFindings,
  findPersonalDetails,
  newPersonalDetails,
} from "../functions/api/_shared/personalDetails.js";

const kinds = (text) => findPersonalDetails(text).map((f) => f.kind);

test("UK mobile numbers are found however they're written", () => {
  for (const text of [
    "07700 900123",
    "07700900123",
    "07700-900-123",
    "07700.900.123",
    "+44 7700 900123",
    "+447700900123",
    "+44 (0)7700 900123",
    "0044 7700 900123",
    "(07700) 900123",
    "Call Sarah on 07911 123456 after 5pm",
    "tel:07700900123",
    "07 700 900 123",
  ]) {
    assert.deepEqual(kinds(text), ["mobile"], text);
  }
});

test("the text matched is what the rep typed, without the words around it", () => {
  assert.equal(findPersonalDetails("Call Sarah on 07911 123456 after 5pm")[0].text, "07911 123456");
});

test("landlines, freephone numbers and everyday numbers are not mobiles", () => {
  for (const text of [
    "020 8123 4567",
    "0208 123 4567",
    "01632 960123",
    "0800 123 4567",
    "0300 123 4567",
    "07700",
    "07700 9001",
    "12345678901",
    "007700900123",
    "07700900123456", // too long to be a number
    "2026-10-08",
    "08/10/2026",
    "3:30pm - 4:45pm",
    "N21 1BB",
    "Year 5, £15.50 per child, 30 places",
    "Tickets 1234567890",
    "The King's Head, 1 The Green, N21 1BB",
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("two different numbers are two findings, the same number written twice is one", () => {
  assert.equal(findPersonalDetails("Sarah 07700 900123 or Tom 07700 900456").length, 2);
  assert.equal(findPersonalDetails("07700 900123 (that's +44 7700 900123)").length, 1);
});

test("email addresses at personal providers are found, whatever their case", () => {
  for (const text of [
    "sarah@gmail.com",
    "Sarah.Jones+pta@Hotmail.co.uk",
    "x@googlemail.com",
    "a_b@icloud.com",
    "mum@btinternet.com",
    "email SARAH@GMAIL.COM to RSVP",
  ]) {
    assert.deepEqual(kinds(text), ["email"], text);
  }
});

test("addresses on an organisation's own domain, and things that only look like email, are not", () => {
  for (const text of [
    "office@st-pauls.enfield.sch.uk",
    "fosps@stpaulsfosps.org",
    "someone@gmail.com.au",
    "meet@3pm",
    "user@localhost",
    "@gmail.com",
    "gmail.com",
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("WhatsApp invite links and wa.me links are found; talking about WhatsApp isn't", () => {
  for (const text of [
    "https://chat.whatsapp.com/AbCdEf123456",
    "join: chat.whatsapp.com/Invite_1-x",
    "https://wa.me/447700900123",
    "wa.me/+447700900123",
  ]) {
    assert.deepEqual(kinds(text), ["whatsapp"], text);
  }
  // The domain can be pasted in any case; the invite code after it keeps its own.
  for (const text of ["HTTPS://CHAT.WHATSAPP.COM/AbCd1234", "Chat.WhatsApp.com/AbCd1234", "WA.ME/447700900123"]) {
    assert.deepEqual(kinds(text), ["whatsapp"], text);
  }
  for (const text of ["Join our WhatsApp group", "https://www.whatsapp.com/download", "whatsapp.com/"]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test("a mix in one text is reported once each", () => {
  assert.deepEqual(kinds("Ring 07700 900123, email sarah@gmail.com, or join chat.whatsapp.com/abc123"), [
    "mobile",
    "email",
    "whatsapp",
  ]);
});

test("nothing, or not text, finds nothing", () => {
  for (const value of ["", "   ", null, undefined, 42, {}, []]) assert.deepEqual(findPersonalDetails(value), []);
});

test("PUBLIC_CONTACTS are never flagged, however they're written", () => {
  PUBLIC_CONTACTS.push("fosps.enfield@gmail.com", "07700 900999");
  try {
    assert.deepEqual(kinds("Email FOSPS.Enfield@Gmail.com"), []);
    assert.deepEqual(kinds("Ring +44 7700 900999"), []);
    assert.deepEqual(kinds("Ring 07700900999"), []);
    assert.deepEqual(kinds("or sarah@gmail.com / 07700 900123"), ["email", "mobile"]); // others still are
  } finally {
    PUBLIC_CONTACTS.length = 0;
  }
});

// --- only what's new ---

test("a brand-new event: everything found counts, with the field it was in", () => {
  const found = newPersonalDetails({ title: "Coffee", description: "Ring 07700 900123", location: "sarah@gmail.com" });
  assert.deepEqual(found.map((f) => [f.field, f.kind]), [["description", "mobile"], ["location", "email"]]);
});

test("a detail already in the saved event isn't asked about again, however it's now written", () => {
  const before = { title: "Coffee", description: "Ring Sarah on 07700 900123" };
  assert.deepEqual(newPersonalDetails({ title: "Coffee morning", description: "Ring Sarah on +44 7700 900123" }, before), []);
  assert.deepEqual(newPersonalDetails({ ...before, description: "Ring Sarah on 07700900123 - new time" }, before), []);
});

test("only the new detail is reported when an edit adds one beside an old one", () => {
  const found = newPersonalDetails(
    { description: "Ring 07700 900123 or 07700 900456" },
    { description: "Ring 07700 900123" }
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].text, "07700 900456");
});

test("moving a detail from one field to another isn't new", () => {
  assert.deepEqual(newPersonalDetails({ title: "Ring 07700 900123", description: "" }, { description: "Ring 07700 900123" }), []);
});

test("a detail that was in any field before isn't new in whichever field it's in now", () => {
  const number = "Ring 07700 900123";
  for (const [was, now] of [
    ["title", "description"],
    ["title", "location"],
    ["location", "description"],
    ["location", "title"],
    ["description", "location"],
  ]) {
    assert.deepEqual(newPersonalDetails({ [now]: number }, { [was]: number }), [], `${was} -> ${now}`);
  }
});

test("the same number in two fields is one thing to confirm", () => {
  const found = newPersonalDetails({ title: "Ring 07700 900123", description: "Ring 07700 900123" });
  assert.equal(found.length, 1);
  assert.equal(found[0].field, "title");
});

test("a missing before or after is fine", () => {
  assert.deepEqual(newPersonalDetails({}, null), []);
  assert.deepEqual(newPersonalDetails(undefined, { description: "07700 900123" }), []);
  assert.equal(newPersonalDetails({ description: "07700 900123" }, {}).length, 1);
});

test("the message names what was found, where, and why it matters", () => {
  const message = describeFindings([{ field: "description", kind: "mobile", text: "07700 900123" }]);
  assert.match(message, /the description has a mobile number \(07700 900123\)/);
  assert.match(message, /public/);
  assert.match(message, /history even if you delete/);
  assert.match(message, /Save anyway\?$/);
  const two = describeFindings(
    [
      { field: "description", kind: "email", text: "a@gmail.com", index: 1 },
      { field: "title", kind: "whatsapp", text: "chat.whatsapp.com/x", index: 2 },
    ],
    (f) => `Event ${f.index + 1}: `
  );
  assert.match(two, /Event 2: the description has a personal email address \(a@gmail\.com\); Event 3: the title has a WhatsApp link/);
});
