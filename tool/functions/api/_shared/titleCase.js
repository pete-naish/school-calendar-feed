// Title Case for event titles extracted from pasted text (see validate.js's
// validateExtractedEvents). The model is asked for Title Case too (parse.js),
// but a prompt can't guarantee it, so every extracted title also goes through
// this. Deliberately conservative - it fixes lowercase words and leaves
// anything that might be intentional alone:
//   - words that already contain a capital ("PE", "INSET", "MacMillan") and
//     words with digits ("1st", "9:30am") are kept as they are, so an
//     all-caps title isn't lowercased and acronyms survive;
//   - a few school acronyms and every class code are (re)written in capitals,
//     so "pe kit" -> "PE Kit" and "5hp trip" -> "5HP Trip";
//   - short articles, conjunctions and prepositions stay lowercase unless
//     they open or close the title, follow a colon or dash, or start a
//     bracketed/quoted phrase.
import { ALL_CALENDARS } from "./calendars.js";

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "via", "vs"]);

const ALWAYS_UPPER = new Set([
  "pe", "pta", "agm", "inset", "fosps", "sats", "pshe", "ict", "uk",
  ...ALL_CALENDARS.map((c) => c.label.toLowerCase()),
]);

const OPENING_PUNCTUATION = /^["'“‘(\[]/;
const BREAK_TOKEN = /^[-–—]$/;

function capitaliseFirstLetter(word) {
  return word.replace(/\p{L}/u, (c) => c.toLocaleUpperCase("en-GB"));
}

// One hyphen-separated piece of a token. `allowSmall` is whether a small word
// may stay lowercase here (not the first/last word, not after a break).
function fixPart(part, allowSmall) {
  const core = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (ALWAYS_UPPER.has(core.toLowerCase())) return part.replace(core, core.toUpperCase());

  const letters = part.replace(/[^\p{L}]/gu, "");
  if (!letters || /\d/.test(part)) return part; // "&", "2026", "1st", "9:30am"
  if (letters !== letters.toLocaleLowerCase("en-GB")) return part; // already has a capital
  if (allowSmall && SMALL_WORDS.has(letters)) return part;
  return capitaliseFirstLetter(part);
}

export function toTitleCase(title) {
  const tokens = title.split(/(\s+)/); // keeps the whitespace so spacing is untouched
  const wordIndexes = tokens.flatMap((t, i) => (t && !/^\s+$/.test(t) ? [i] : []));
  const first = wordIndexes[0];
  const last = wordIndexes[wordIndexes.length - 1];

  let afterBreak = false; // previous token ended in ":" or was a lone dash
  return tokens
    .map((token, i) => {
      if (!wordIndexes.includes(i)) return token;
      const mustCapitalise = i === first || i === last || afterBreak || OPENING_PUNCTUATION.test(token);
      afterBreak = token.endsWith(":") || BREAK_TOKEN.test(token);
      // Later pieces of a hyphenated word ("Face-to-Face") may stay lowercase.
      return token
        .split("-")
        .map((part, j) => fixPart(part, j > 0 || !mustCapitalise))
        .join("-");
    })
    .join("");
}
