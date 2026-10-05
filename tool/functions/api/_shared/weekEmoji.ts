// An emoji for an event title in the "What's on this week" WhatsApp list
// (see weekList.ts), standing in for its "•" bullet. A fixed keyword table,
// not a model call: free, instant, and the same list every time it's built.
//
// First match wins, so the order matters: specific before general (a trip to
// the zoo is 🦁 before it's 🚌; a Christmas holiday is 🎄 before it's 🏖️).
// Add a row when reps start posting a kind of event with no emoji yet -
// tests/weekEmoji.test.mjs lists the titles each row is meant for.
export const EMOJI_RULES: [RegExp, string][] = [
  [/\binset\b|\bschool closed\b/i, "🚫"],
  [/\bchristmas\b|\bxmas\b/i, "🎄"],
  [/\bhalf term\b|\bholiday\b/i, "🏖️"],
  [/\blast day of\b.*\bterm\b/i, "🎉"],
  [/\bschool opens\b|\bfirst day\b|\bstart\b/i, "🎒"],
  [/\bphoto(graph)?s?\b/i, "📸"],
  [/\bflu\b|\bvaccin|\bimmunis/i, "💉"],
  [/\bPE\b|\bsports?\b/i, "👟"],
  [/\bswim/i, "🏊"],
  [/\bcoffee\b/i, "☕"],
  [/\bdrinks\b/i, "🥂"],
  [/\bfruit\b/i, "🍓"],
  [/\bharvest\b|\bvegetables?\b/i, "🥕"],
  [/\bcakes?\b|\bbake\b/i, "🍰"],
  [/\blunch\b|\bpicnic\b/i, "🍽️"],
  [/\bfair\b|\bfete\b/i, "🎪"],
  [/\bsale\b/i, "🛍️"],
  [/\bproduction\b|\brehearsal\b|\bnativity\b|\bplay\b|\bpanto/i, "🎭"],
  [/\bfilm\b|\bmovie\b|\bcinema\b/i, "🎬"],
  [/\bpart(y|ies)\b|\bdisco\b/i, "🎉"],
  [/\bchurch\b|\beucharist\b|\bservice\b|\bchristingle\b|\babbey\b|\bcathedral\b/i, "⛪"],
  [/\bworship\b|\bassembly\b/i, "🙏"],
  [/\bzoo\b|\bsafari\b/i, "🦁"],
  [/\bmuseum\b|\bgallery\b/i, "🏛️"],
  [/\btrip\b|\bvisit\b|\bouting\b|^(year \d|reception)\s*(-|to)\s/i, "🚌"],
  [/\bconsultation\b|\bparents'? evening\b/i, "🗣️"],
  [/\bmeeting\b|\binformation\b|\bworkshop\b/i, "📋"],
  [/\bassessment\b|\btests?\b|\bsats\b|\bexams?\b|\bphonics\b/i, "📝"],
  [/\bbooks?\b|\breading\b|\blibrary\b/i, "📚"],
  [/\bspace\b|\btelescopes?\b|\bplanets?\b/i, "🚀"],
  [/\bscience\b/i, "🔬"],
  [/\bmusic\b|\bconcert\b|\bchoir\b|\bsing/i, "🎵"],
  [/\bbullying\b/i, "💙"],
  [/\byoung minds\b|\bhello yellow\b|\bmental health\b|\bwell-?being\b/i, "💛"],
  [/\bwreath\b/i, "🌿"],
  [/\bagm\b|\belection\b|\bvote\b/i, "🗳️"],
  [/\bjumper\b|\bfancy dress\b|\bdress up\b|\bmufti\b|\bnon-uniform\b|\bpyjama/i, "👕"],
  [/\bbirthday\b/i, "🎂"],
  [/\bbring\b/i, "🎒"],
];

const HAS_EMOJI = /\p{Extended_Pictographic}/u;
// The week list prefixes FOSPS and whole-school events in a class's list.
const LIST_PREFIX = /^(FOSPS|Whole School):\s*/;

// The emoji for `title`, or null: none matches, or the title has an emoji of
// its own already (a rep's "PE Day 👟") and doesn't need another.
export function emojiFor(title: string): string | null {
  if (HAS_EMOJI.test(title)) return null;
  const bare = title.replace(LIST_PREFIX, "");
  for (const [pattern, emoji] of EMOJI_RULES) {
    if (pattern.test(bare)) return emoji;
  }
  return null;
}
