// A card's poster: an image a rep attaches to an event (a FOSPS flyer, say),
// shown on the public page with the event and linked from calendar apps. The
// picked image is shrunk and re-saved as a JPEG here in the browser - which
// also drops its EXIF data, a phone photo's location among it - and uploaded
// straight away (POST /api/poster-upload) with a small copy for link previews
// (see shrink()). The card keeps just the key that comes back, which goes out
// with the rest of the event when the card is saved; see
// functions/api/_shared/posters.ts.
import { find } from "./dom.js";
import { apiCall, state } from "./state.js";
const MAX_EDGE = 1600; // px, longest side - enough to read a poster's small print
const QUALITY = 0.82;
const MAX_BYTES = 2_000_000; // the server's ceiling (MAX_POSTER_BYTES)
const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const MAX_PREVIEW_BYTES = 300_000; // MAX_PREVIEW_BYTES on the server
export function posterSrc(key) {
    return `/posters/${key}`;
}
// The poster the card holds now, or null.
export function posterKey(card) {
    return card.dataset.poster || null;
}
// Whether a poster is still uploading - the card mustn't be saved without it.
export function posterBusy(card) {
    return card.dataset.posterUploading === "1";
}
export const POSTER_BUSY_MESSAGE = "Wait for the poster to finish uploading, then save.";
function show(card, key) {
    if (key)
        card.dataset.poster = key;
    else
        delete card.dataset.poster;
    const thumb = find(card, ".poster-thumb");
    const img = find(thumb, "img");
    thumb.hidden = !key;
    if (key) {
        thumb.href = posterSrc(key);
        img.src = posterSrc(key);
    }
    else {
        thumb.removeAttribute("href");
        img.removeAttribute("src");
    }
    find(card, ".poster-pick-button").textContent = key ? "Replace poster" : "Add poster";
    find(card, ".poster-remove-button").hidden = !key;
}
// Fills the card's poster field and wires it up. Hidden when posters aren't
// set up on the server (state.posters).
export function setupPosterField(card, key) {
    const field = find(card, ".poster-field");
    field.hidden = !state.posters;
    if (!state.posters)
        return;
    const input = find(card, ".poster-input");
    const status = find(card, ".poster-status");
    const pick = find(card, ".poster-pick-button");
    show(card, key || null);
    pick.addEventListener("click", () => input.click());
    input.addEventListener("input", (e) => e.stopPropagation());
    find(card, ".poster-remove-button").addEventListener("click", () => {
        show(card, null);
        status.textContent = "Poster removed - save to make it stick.";
        // Marks the card as having unsaved changes (trackChanges in cardState.ts).
        field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.addEventListener("change", async (e) => {
        // The file input's own change would mark the card edited before there's
        // anything to save - the upload finishing does that instead.
        e.stopPropagation();
        const file = input.files && input.files[0];
        input.value = "";
        if (!file)
            return;
        card.dataset.posterUploading = "1";
        pick.disabled = true;
        status.textContent = "Uploading poster…";
        try {
            const { poster, preview } = await shrink(file);
            const resp = await apiCall("/api/poster-upload", {
                calendar: state.calendar,
                passcode: state.passcode,
                data: await toBase64(poster),
                preview: await toBase64(preview),
            });
            if (!resp.ok) {
                status.textContent = (resp.data && resp.data.message) || "Couldn't upload the poster - try again.";
                return;
            }
            show(card, resp.data.image);
            status.textContent = "Poster added - save to make it stick.";
            field.dispatchEvent(new Event("change", { bubbles: true }));
        }
        catch {
            status.textContent = "Couldn't read that image - try a photo or screenshot (a PDF won't work).";
        }
        finally {
            delete card.dataset.posterUploading;
            pick.disabled = false;
        }
    });
}
function encode(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode"))), "image/jpeg", quality));
}
// The smallest of `qualities` that fits in `maxBytes`, best first.
async function encodeWithin(canvas, qualities, maxBytes) {
    for (const quality of qualities) {
        const blob = await encode(canvas, quality);
        if (blob.size <= maxBytes)
            return blob;
    }
    throw new Error("Too big");
}
function canvasOf(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("No canvas");
    return { canvas, ctx };
}
// The image's average colour, as a CSS colour - the preview's background.
function averageColour(bitmap) {
    const { ctx } = canvasOf(1, 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
}
// The poster as a JPEG no bigger than MAX_EDGE on its longest side, and its
// link-preview copy: 1200x630 (the shape WhatsApp shows big) with the whole
// poster fitted in, on its own average colour. Anything the browser can open
// works (a phone's HEIC photo included); a transparent PNG gets a white
// background rather than JPEG's black.
async function shrink(file) {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const full = canvasOf(bitmap.width * scale, bitmap.height * scale);
        full.ctx.fillStyle = "#ffffff";
        full.ctx.fillRect(0, 0, full.canvas.width, full.canvas.height);
        full.ctx.drawImage(bitmap, 0, 0, full.canvas.width, full.canvas.height);
        const small = canvasOf(PREVIEW_WIDTH, PREVIEW_HEIGHT);
        small.ctx.fillStyle = averageColour(bitmap);
        small.ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        const fit = Math.min(PREVIEW_WIDTH / bitmap.width, PREVIEW_HEIGHT / bitmap.height);
        const w = bitmap.width * fit;
        const h = bitmap.height * fit;
        small.ctx.fillStyle = "#ffffff";
        small.ctx.fillRect((PREVIEW_WIDTH - w) / 2, (PREVIEW_HEIGHT - h) / 2, w, h);
        small.ctx.drawImage(bitmap, (PREVIEW_WIDTH - w) / 2, (PREVIEW_HEIGHT - h) / 2, w, h);
        return {
            poster: await encodeWithin(full.canvas, [QUALITY, 0.6], MAX_BYTES),
            preview: await encodeWithin(small.canvas, [0.8, 0.65, 0.5], MAX_PREVIEW_BYTES),
        };
    }
    finally {
        bitmap.close();
    }
}
async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}
