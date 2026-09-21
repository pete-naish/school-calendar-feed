// A warning, not a rule, for text that looks like it holds someone's personal
// contact details. Everything a rep saves is published on a public calendar and
// committed to a public repository, where it stays in the history even after the
// event is deleted - so a mobile number pasted in from a WhatsApp message is
// worth a second look. Nothing here blocks a save: the rep is shown what was
// found and can save anyway (reps sometimes add a contact on purpose).
//
// It looks for three things, chosen because they're rarely a false alarm:
//   - UK mobile numbers (07..., +44 7...). Landlines aren't flagged: a venue's or
//     the office's number is meant to be public.
//   - email addresses at personal providers (gmail, hotmail...). An address on an
//     organisation's own domain isn't.
//   - WhatsApp group invite links (anyone with one can join the group), and
//     wa.me links (which hold a phone number).
// It does not try to spot names, children, or addresses - that would flag every
// pub and school hall - so it's a safety net, not a guarantee.

// Contacts that are meant to be public and are never flagged: put an address
// (lower case) or a number in here, e.g. the FOSPS mailbox. Numbers are compared
// as digits only, so "07700 900123" and "07700900123" are the same.
export const PUBLIC_CONTACTS = [];

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk", "live.com", "live.co.uk", "msn.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aol.co.uk",
  "btinternet.com", "btopenworld.com", "sky.com", "virginmedia.com", "ntlworld.com", "talktalk.net", "blueyonder.co.uk",
  "protonmail.com", "proton.me", "pm.me", "gmx.com", "gmx.co.uk", "mail.com",
]);

// 07..., +44 7..., +44 (0)7..., 0044 7..., (07700) 900123 - with spaces, dots,
// dashes or brackets (up to two together, as in ") ") between the digits: a 7
// followed by exactly nine more digits, with a national or international prefix
// in front, and not part of a longer run of digits.
const MOBILE = /(?<![\d+])(?:(?:\+|00)?44[\s.-]?\(?0?\)?[\s.-]?|\(?0\)?[\s.-]?)7(?:[\s.()-]{0,2}\d){9}(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const WHATSAPP = /\b(?:chat\.whatsapp\.com\/[A-Za-z0-9_-]+|wa\.me\/\+?\d+)/gi;

const digitsOf = (text) => text.replace(/\D/g, "");

// What makes two findings "the same detail", however it's written.
function keyOf({ kind, text }) {
  if (kind === "mobile") return `mobile:${digitsOf(text).replace(/^(?:00)?440?/, "0")}`;
  return `${kind}:${text.toLowerCase()}`;
}

const isPublicContact = ({ kind, text }) =>
  PUBLIC_CONTACTS.some((contact) =>
    kind === "mobile" ? digitsOf(contact) !== "" && keyOf({ kind, text: contact }) === keyOf({ kind, text }) : contact.toLowerCase() === text.toLowerCase()
  );

// Every distinct personal detail in one piece of text, in the order it appears:
// [{ kind, text }].
export function findPersonalDetails(text) {
  if (typeof text !== "string" || !text) return [];
  const found = new Map();
  const add = (kind, match) => {
    const finding = { kind, text: match[0].trim() };
    const key = keyOf(finding);
    if (isPublicContact(finding)) return;
    if (!found.has(key) || match.index < found.get(key).at) found.set(key, { finding, at: match.index });
  };
  const whatsapp = [...text.matchAll(WHATSAPP)];
  for (const m of whatsapp) add("whatsapp", m);
  // A wa.me link holds a phone number: that's the one finding, not two.
  const insideWhatsappLink = (m) => whatsapp.some((w) => m.index >= w.index && m.index < w.index + w[0].length);
  for (const m of text.matchAll(MOBILE)) if (!insideWhatsappLink(m)) add("mobile", m);
  for (const m of text.matchAll(EMAIL)) if (PERSONAL_EMAIL_DOMAINS.has(m[1].toLowerCase())) add("email", m);
  return [...found.values()].sort((a, b) => a.at - b.at).map(({ finding }) => finding);
}

const FIELDS = ["title", "description", "location"];

// The personal details in an event's (or an edit's) title, description and
// location that weren't already in `before` - what it looked like before this
// save, or null for a brand-new event. Only new ones count, so changing the time
// of an event whose description holds a number the rep already confirmed doesn't
// ask again. Returns [{ field, kind, text }].
export function newPersonalDetails(after, before = null) {
  const already = new Set();
  for (const field of FIELDS) {
    for (const finding of findPersonalDetails(before && before[field])) already.add(keyOf(finding));
  }
  const out = [];
  for (const field of FIELDS) {
    for (const finding of findPersonalDetails(after && after[field])) {
      // The same number in the title and the description is one thing to confirm.
      if (already.has(keyOf(finding))) continue;
      already.add(keyOf(finding));
      out.push({ field, ...finding });
    }
  }
  return out;
}

const KIND_LABEL = { mobile: "a mobile number", email: "a personal email address", whatsapp: "a WhatsApp link" };

// The sentence shown to the rep. `prefix` says which event when there are
// several ("Event 2: ").
export function describeFindings(findings, prefix = () => "") {
  const lines = findings.map((f) => `${prefix(f)}the ${f.field} has ${KIND_LABEL[f.kind]} (${f.text})`);
  return (
    `This looks like personal contact information: ${lines.join("; ")}. ` +
    "Calendar events are public, and once saved they stay in the site's history even if you delete them later. " +
    "Save anyway?"
  );
}

// The response body for a save that needs the rep's OK first.
export function confirmPublicResponse(findings, prefix) {
  return { error: "confirm_public", message: describeFindings(findings, prefix), findings };
}
