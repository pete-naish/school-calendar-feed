// "Copy for WhatsApp" and "Share" on a saved event's card: a short message
// (title, when/where, link - see whatsAppEventMessage() in appHelpers.ts) in
// place of the paragraphs and posters that otherwise get pasted into class
// groups. The link's preview shows the poster. Share, where the device has a
// share sheet, sends the same message with the poster attached as an image.
//
// Both use the event as last saved, since that's what the link shows. The
// event's page (and so its preview, and the calendar) only catches up a few
// minutes after a save, and WhatsApp keeps the first preview it fetches - so
// after a save, and after copying, the card asks GET /api/event-ready whether
// the page has the save's version stamp yet, keeps asking until it does, and
// says when it's live and safe to post.
import { whatsAppEventMessage } from "../appHelpers.js";
import { todayIso } from "./dates.js";
import { el, find } from "./dom.js";
import { cardState } from "./cardState.js";
import { posterSrc } from "./poster.js";
import { track } from "./track.js";
const POLL_MS = 20 * 1000;
// A rebuild plus GitHub Pages' cache (up to 10 minutes) - past this, something's stuck.
const GIVE_UP_MS = 25 * 60 * 1000;
async function isReady(key, rev) {
    const params = new URLSearchParams({ key, ...(rev && { rev }) });
    try {
        const resp = await fetch(`/api/event-ready?${params}`);
        if (!resp.ok)
            return false;
        return (await resp.json()).ready;
    }
    catch {
        return false;
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Asks event-ready about `events` until every one's page is up to date,
// calling `onWaiting` once if the first answer is "not yet". `still` says
// whether anyone still wants to know (the card hasn't been saved again, say).
async function pollUntilLive(events, still, onWaiting) {
    const started = Date.now();
    let waited = false;
    let pending = events;
    for (;;) {
        const answers = await Promise.all(pending.map((e) => isReady(e.key, e.rev)));
        if (!still())
            return { outcome: "cancelled", waited };
        pending = pending.filter((_, i) => !answers[i]);
        if (pending.length === 0)
            return { outcome: "ready", waited };
        if (Date.now() - started > GIVE_UP_MS)
            return { outcome: "stuck", waited };
        if (!waited) {
            waited = true;
            onWaiting();
        }
        await sleep(POLL_MS);
    }
}
const watches = new WeakMap();
const STUCK = "The calendar still isn't up to date after 25 minutes - something may be stuck. Try again later, or ask whoever looks after the calendar.";
function message(w) {
    if (w.phase === "stuck")
        return STUCK;
    if (w.context === "save") {
        if (w.phase === "checking")
            return "Saved ✓ - updating the calendar…";
        if (w.phase === "waiting")
            return "Saved ✓ - updating the calendar (usually a few minutes)…";
        return "Saved ✓ - it's live on the calendar now.";
    }
    if (w.phase === "checking")
        return "Copied ✓. Checking the link's ready…";
    if (w.phase === "waiting") {
        return "Copied ✓. Don't post it yet: the event's page is still updating after the last save (usually a few minutes). This will say when it's ready.";
    }
    if (w.waited)
        return "Link ready ✓ - go ahead and post it.";
    const unsaved = w.unsaved ? " It's the saved version - save your changes first if they should be in it." : "";
    return `Copied ✓. The link's ready - paste it into WhatsApp.${unsaved}`;
}
// Shows on the card whether its saved event is live on the public site,
// checking until it is.
async function watchCard(card, event, context) {
    const status = find(card, ".card-status");
    const stamp = `${event.key}|${event.rev ?? ""}`;
    const existing = watches.get(card);
    if (existing && existing.stamp === stamp && (existing.phase === "checking" || existing.phase === "waiting")) {
        existing.context = context;
        existing.unsaved = cardState(card).dirty;
        status.textContent = message(existing);
        return;
    }
    const watch = { stamp, context, phase: "checking", waited: false, unsaved: cardState(card).dirty };
    watches.set(card, watch);
    status.textContent = message(watch);
    // Stops when another check takes over, or the event's saved again (its
    // stamp changes, and that save starts its own).
    const still = () => watches.get(card) === watch && cardState(card).rev === event.rev;
    const result = await pollUntilLive([event], still, () => {
        watch.phase = "waiting";
        watch.waited = true;
        status.textContent = message(watch);
    });
    if (result.outcome === "cancelled")
        return;
    watch.phase = result.outcome;
    status.textContent = message(watch);
}
// Each card's `read` (see setupEventShare), for watchSaved().
const readers = new WeakMap();
// After a card's saved: says when the change is live on the calendar.
export function watchSaved(card) {
    const read = readers.get(card);
    if (read)
        void watchCard(card, read(), "save");
}
// After saving new events (which come back as new cards, folded away): one
// message for them all, through `show`.
export async function watchNewEvents(events, show, saved) {
    if (events.length === 0)
        return;
    let last = `${saved} Updating the calendar…`;
    show(last);
    // Stops once the list's message is about something else (a delete, say).
    const still = () => el.existingStatusText.textContent === last;
    const say = (text) => {
        last = text;
        show(text);
    };
    const result = await pollUntilLive(events, still, () => say(`${saved} Updating the calendar (usually a few minutes)…`));
    if (result.outcome === "cancelled")
        return;
    const live = events.length === 1 ? "It's live on the calendar now ✓" : "They're live on the calendar now ✓";
    say(result.outcome === "ready" ? `${saved} ${live}` : `${saved} ${STUCK}`);
}
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
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
async function posterFile(image) {
    if (!image)
        return null;
    try {
        const resp = await fetch(posterSrc(image));
        if (!resp.ok)
            return null;
        return new File([await resp.blob()], "poster.jpg", { type: "image/jpeg" });
    }
    catch {
        return null;
    }
}
// `read` gives the event as last saved, with its poster and version stamp.
export function setupEventShare(card, read) {
    readers.set(card, read);
    const copyButton = find(card, ".card-copy-button");
    const shareButton = find(card, ".card-share-button");
    copyButton.hidden = false;
    copyButton.addEventListener("click", async () => {
        const event = read();
        // Copied straight away - the clipboard only allows it during the click.
        if (!(await copy(whatsAppEventMessage(event, todayIso())))) {
            find(card, ".card-status").textContent = "Couldn't copy - your browser blocked it.";
            return;
        }
        track("event_copy");
        await watchCard(card, event, "copy");
    });
    if (typeof navigator.share !== "function")
        return;
    shareButton.hidden = false;
    // A share sheet has to open during the click, so the poster is fetched
    // ahead of it: when the card's opened (its summary is clicked).
    let poster = null;
    const prefetch = () => {
        const { image } = read();
        if (image && poster?.image !== image)
            poster = { image, file: posterFile(image) };
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
        void watchCard(card, event, "copy");
        try {
            await navigator.share(withFile ? { files: [file], text } : { text });
            track("event_share");
        }
        catch {
            // Closing the share sheet rejects too - nothing to say.
        }
    });
}
