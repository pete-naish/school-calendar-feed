// Run with: node --test tool/tests/
//
// The "What's on this week" emoji: every kind of title the feeds have carried
// so far gets the emoji meant for it (or none), first match winning.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emojiFor } from "../functions/api/_shared/weekEmoji.ts";

const EXPECTED = {
  "INSET DAY - school closed to pupils": "🚫",
  "Christmas Holiday": "🎄",
  "Christmas Jumper Day": "🎄",
  "Christmas Lunch / Christmas Film": "🎄",
  "Half Term Break": "🏖️",
  "Last Day of Autumn Term": "🎉",
  "School opens to children": "🎒",
  "Reception Group 3 Start": "🎒",
  "Individual and Sibling photographs": "📸",
  "Production Photos": "📸",
  "Bring Baby Photo for R.E Lesson": "📸",
  "Nasal Flu Spray": "💉",
  "Nasal Flu Vaccination catch up": "💉",
  "MacMillan Coffee Morning": "☕",
  "Reception Parent / Carer Drinks": "🥂",
  "Bring Cut Fruit for Fruit Kebabs": "🍓",
  "Harvest Vegetable Donations": "🥕",
  "All Reception Children - stay for lunch": "🍽️",
  "Winter Fair": "🎪",
  "Pre-Loved Uniform & Fancy Dress Sale": "🛍️",
  "R/KS1 Production": "🎭",
  "R/KS1 Dress rehearsal to KS2": "🎭",
  "Christmas Parties": "🎄",
  "Christingle at St Paul's Church": "⛪",
  "Eucharist Year 5 and Year 6 - St Paul's Church": "⛪",
  "Whole School Church Service (not Reception Children)": "⛪",
  "Year 5 - Westminster Abbey": "⛪",
  "5M Collective Worship": "🙏",
  "Year 5 to London Zoo": "🦁",
  "Year 3 to Celtic Harmony": "🚌",
  "Parent Consultation Meetings": "🗣️",
  "Information meeting for Parents - KS2": "📋",
  "Assessment Week": "📝",
  "World Space Week - Bring Space Themed Items": "🚀",
  "Bring Kitchen Roll Tube for Telescopes": "🚀",
  "Anti - Bullying Week": "💙",
  "Young Minds - Hello Yellow": "💛",
  "Wreath Making": "🌿",
  "AGM and Executive Election": "🗳️",
  "All Reception Children - stay full time": null,
};

test("each title the feeds have carried gets its emoji", () => {
  for (const [title, emoji] of Object.entries(EXPECTED)) {
    assert.equal(emojiFor(title), emoji, title);
  }
});

test("a title with its own emoji doesn't get another", () => {
  assert.equal(emojiFor("PE Day 👟 – Wear PE Kit"), null);
});

test("the week list's FOSPS and Whole School prefixes are ignored", () => {
  assert.equal(emojiFor("FOSPS: Coffee Morning"), "☕");
  assert.equal(emojiFor("Whole School: Half Term Break"), "🏖️");
  // "School" in the prefix isn't "School opens".
  assert.equal(emojiFor("Whole School: Individual and Sibling photographs"), "📸");
});

test("matching is on whole words", () => {
  assert.equal(emojiFor("Pepper planting"), null); // not PE
  assert.equal(emojiFor("Testament reading"), "📚"); // not "test"
});
