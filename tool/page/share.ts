// "Share": what a rep needs to get parents subscribed - a link to the public
// page with their calendar already ticked (its ?c= parameter, see
// applyLinkedCalendar() in docs/assets/calendar.ts), a message to paste into
// the class WhatsApp group, a QR code for the newsletter or the classroom
// door, and how many subscribe taps their calendar has had so far.
import qrcode from "../vendor/qrcode.js";
import { copyText, el } from "./dom.js";
import { FOSPS, WHOLE_SCHOOL, apiCall, state } from "./state.js";
import { track } from "./track.js";
import type { StatsResponse } from "../functions/api/_shared/types.d.ts";

export const PUBLIC_SITE = "https://calendar.nai.sh/";

// Whole School is ticked for every visitor anyway, so it gets the plain address.
export function shareLink(calendar: string) {
  return calendar === WHOLE_SCHOOL.code ? PUBLIC_SITE : `${PUBLIC_SITE}?c=${encodeURIComponent(calendar)}`;
}

export function shareMessage(calendar: string, label: string, link: string) {
  const what =
    calendar === WHOLE_SCHOOL.code
      ? "St Paul's school dates"
      : calendar === FOSPS.code
        ? "FOSPS events"
        : `${label}'s class events and the school's dates`;
  return (
    `📅 Get ${what} in your phone's calendar: tap the link, pick your calendar app, ` +
    `and it keeps itself up to date - nothing to download.\n${link}`
  );
}

const PLATFORM_NAMES: [keyof StatsResponse["by_platform"], string][] = [
  ["apple", "Apple"],
  ["google", "Google"],
  ["outlook", "Outlook"],
  ["link", "copied link"],
];

// "Apple 14 · Google 7" - only the platforms with any taps.
export function platformBreakdown(byPlatform: StatsResponse["by_platform"]) {
  return PLATFORM_NAMES.filter(([key]) => byPlatform[key] > 0)
    .map(([key, name]) => `${name} ${byPlatform[key]}`)
    .join(" · ");
}

function calendarLabel(calendar: string) {
  return state.allCalendars.find((c) => c.code === calendar)?.label ?? calendar;
}

// The calendar the link and message were last filled in for: opening the tab
// again keeps any edit the rep made to the message, until they switch calendar.
let filledFor: string | null = null;

export async function handleShare() {
  const calendar = state.calendar;
  if (!calendar) return;
  if (filledFor !== calendar) {
    filledFor = calendar;
    const link = shareLink(calendar);
    el.shareLink.value = link;
    el.shareMessage.value = shareMessage(calendar, calendarLabel(calendar), link);
    el.shareLinkCopyStatus.textContent = "";
    el.shareMessageCopyStatus.textContent = "";
    el.shareCount.hidden = true;
    drawQr(link);
  }

  const { ok, data } = await apiCall<StatsResponse>("/api/stats", { calendar, passcode: state.passcode });
  if (state.calendar !== calendar) return; // switched calendar while it loaded
  if (!ok || !data.available) {
    el.shareCount.hidden = true;
    return;
  }
  el.shareCountNumber.textContent = String(data.total);
  const parts = [
    `${data.total === 1 ? "tap" : "taps"} on a subscribe link for ${calendarLabel(calendar)} so far`,
  ];
  const breakdown = platformBreakdown(data.by_platform);
  el.shareCountDetail.textContent =
    parts[0] + (breakdown ? ` (${breakdown})` : "") + (data.total > 0 ? `, ${data.this_month} this month.` : ".");
  el.shareCount.hidden = false;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const QR_MARGIN = 4; // the quiet zone scanners need, in modules

let qrModules: boolean[][] = [];

function drawQr(link: string) {
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const count = qr.getModuleCount();
  qrModules = Array.from({ length: count }, (_, r) => Array.from({ length: count }, (_, c) => qr.isDark(r, c)));

  // One path of 1x1 squares rather than an <img>: the CSP allows no data:
  // images, and attributes (unlike style="") are fine.
  const size = count + QR_MARGIN * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR code for ${link}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#ffffff");
  const squares = document.createElementNS(SVG_NS, "path");
  let d = "";
  qrModules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) d += `M${c + QR_MARGIN} ${r + QR_MARGIN}h1v1h-1z`;
    })
  );
  squares.setAttribute("d", d);
  squares.setAttribute("fill", "#000000");
  svg.append(background, squares);
  el.shareQr.replaceChildren(svg);
}

// A PNG, since that's what a newsletter template or a Word document takes
// most readily. Drawn on a canvas (no image load, so nothing for the CSP to
// block) and handed over as a blob: link.
function downloadQr() {
  if (!qrModules.length || !state.calendar) return;
  const scale = 16;
  const size = (qrModules.length + QR_MARGIN * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#000000";
  qrModules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect((c + QR_MARGIN) * scale, (r + QR_MARGIN) * scale, scale, scale);
    })
  );
  const name = `${calendarLabel(state.calendar).replace(/[^A-Za-z0-9]+/g, "-")}-calendar-qr.png`;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track("qr_download");
  }, "image/png");
}

export function wireShare() {
  el.shareLinkCopyButton.addEventListener("click", async () => {
    const copied = await copyText(el.shareLink);
    if (copied) track("share_link_copy");
    el.shareLinkCopyStatus.textContent = copied ? "Copied ✓" : "Couldn't copy - the link is selected, so press Ctrl/Cmd+C.";
  });
  el.shareMessageCopyButton.addEventListener("click", async () => {
    const copied = await copyText(el.shareMessage);
    if (copied) track("share_message_copy");
    el.shareMessageCopyStatus.textContent = copied
      ? "Copied ✓ - paste it into WhatsApp."
      : "Couldn't copy - the text is selected, so press Ctrl/Cmd+C.";
  });
  el.shareQrDownloadButton.addEventListener("click", downloadQr);
}
