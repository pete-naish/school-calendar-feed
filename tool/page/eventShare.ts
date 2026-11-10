// "Copy for WhatsApp" and "Share" on a saved event's card: a short message
// (title, when/where, link - see whatsAppEventMessage() in appHelpers.ts) in
// place of the paragraphs and posters that otherwise get pasted into class
// groups. The link's preview shows the poster. Share, where the device has a
// share sheet, sends the same message with the poster attached as an image.
//
// Both use the event as last saved, since that's what the link shows. The
// event's page (and so its preview) only catches up a few minutes after a
// save, and WhatsApp keeps the first preview it fetches - so after copying,
// the card asks GET /api/event-ready whether the page has this save's version
// stamp yet, and if not keeps asking, and says when it's safe to post.
import { whatsAppEventMessage } from "../appHelpers.js";
import type { SharedEvent } from "../appHelpers.js";
import { todayIso } from "./dates.js";
import { find } from "./dom.js";
import { cardState } from "./cardState.js";
import { posterSrc } from "./poster.js";
import { track } from "./track.js";
import type { EventReadyResponse } from "../functions/api/_shared/types.d.ts";

const POLL_MS = 20 * 1000;
// A rebuild plus GitHub Pages' cache (up to 10 minutes) - past this, something's stuck.
const GIVE_UP_MS = 25 * 60 * 1000;

export type ShareRead = SharedEvent & { image?: string | null; rev?: string };

async function isReady(key: string, rev: string | undefined) {
  const params = new URLSearchParams({ key, ...(rev && { rev }) });
  try {
    const resp = await fetch(`/api/event-ready?${params}`);
    if (!resp.ok) return false;
    return ((await resp.json()) as EventReadyResponse).ready;
  } catch {
    return false;
  }
}

// Cards with a check under way, so a second copy doesn't start another.
const watching = new WeakMap<HTMLElement, string>();

// `done` (what was just done, if anything) then `text`.
const say = (done: string, text: string) => (done ? `${done} ${text}` : text);

// Says on the card whether the link's ready to post, checking until it is.
async function reportReadiness(card: HTMLElement, event: ShareRead, done: string) {
  const status = find(card, ".card-status");
  const stamp = `${event.key}|${event.rev ?? ""}`;
  if (watching.get(card) === stamp) return;
  watching.set(card, stamp);
  const unsaved = cardState(card).dirty ? " It's the saved version - save your changes first if they should be in it." : "";
  status.textContent = say(done, "Checking the link's ready…");
  const started = Date.now();
  let waited = false;
  // Stops when another copy takes over, or the event's saved again (its
  // stamp changes, and a copy after that starts afresh).
  const current = () => watching.get(card) === stamp && cardState(card).rev === event.rev;
  while (current()) {
    const ready = await isReady(event.key, event.rev);
    if (!current()) break;
    if (ready) {
      status.textContent = waited
        ? "Link ready ✓ - go ahead and post it."
        : say(done, `The link's ready - paste it into WhatsApp.${unsaved}`);
      break;
    }
    if (Date.now() - started > GIVE_UP_MS) {
      status.textContent =
        "The link still isn't up to date after 25 minutes - something may be stuck. Try again later, or ask whoever looks after the calendar.";
      break;
    }
    if (!waited) {
      waited = true;
      status.textContent = say(
        done,
        "Don't post it yet: the event's page is still updating after the last save (usually a few minutes). This will say when it's ready."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (watching.get(card) === stamp) watching.delete(card);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No Clipboard API (or blocked): the legacy copy command, from a
    // throwaway text box.
    const box = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  }
}

// The poster as a file to share, or null (none, or it couldn't be fetched).
async function posterFile(image: string | null | undefined) {
  if (!image) return null;
  try {
    const resp = await fetch(posterSrc(image));
    if (!resp.ok) return null;
    return new File([await resp.blob()], "poster.jpg", { type: "image/jpeg" });
  } catch {
    return null;
  }
}

// `read` gives the event as last saved, with its poster and version stamp.
export function setupEventShare(card: HTMLElement, read: () => ShareRead) {
  const copyButton = find<HTMLButtonElement>(card, ".card-copy-button");
  const shareButton = find<HTMLButtonElement>(card, ".card-share-button");
  copyButton.hidden = false;
  copyButton.addEventListener("click", async () => {
    const event = read();
    // Copied straight away - the clipboard only allows it during the click.
    if (!(await copy(whatsAppEventMessage(event, todayIso())))) {
      find(card, ".card-status").textContent = "Couldn't copy - your browser blocked it.";
      return;
    }
    track("event_copy");
    await reportReadiness(card, event, "Copied ✓.");
  });

  if (typeof navigator.share !== "function") return;
  shareButton.hidden = false;
  // A share sheet has to open during the click, so the poster is fetched
  // ahead of it: when the card's opened (its summary is clicked).
  let poster: { image: string; file: Promise<File | null> } | null = null;
  const prefetch = () => {
    const { image } = read();
    if (image && poster?.image !== image) poster = { image, file: posterFile(image) };
  };
  find(card, ".card-summary").addEventListener("click", prefetch);
  shareButton.addEventListener("pointerdown", prefetch);
  shareButton.addEventListener("click", async () => {
    const event = read();
    prefetch();
    const file = event.image && poster ? await poster.file : null;
    const text = whatsAppEventMessage(event, todayIso());
    const withFile = file && navigator.canShare && navigator.canShare({ files: [file] });
    // Not awaited: the check runs while the share sheet is open.
    void reportReadiness(card, event, "");
    try {
      await navigator.share(withFile ? { files: [file], text } : { text });
      track("event_share");
    } catch {
      // Closing the share sheet rejects too - nothing to say.
    }
  });
}
