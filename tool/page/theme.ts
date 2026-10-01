// Light / dark mode, as on the public page (docs/index.html): follows the
// device until someone presses a .theme-toggle button, then remembers their
// choice in this browser.
//
// Unlike the rest of page/, this is a classic script, not a module: index.html
// loads it in <head> without `defer`, so a saved theme is on <html> before the
// page is first drawn (no flash of the other mode). The public page does that
// with an inline script, which the tool's CSP doesn't allow. It has no imports
// or exports, so tsc leaves it a plain script.
{
  const KEY = "stpauls-theme";
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {
    // no storage (private window, blocked site data): follow the device
  }

  const current = () => root.dataset.theme || (systemDark.matches ? "dark" : "light");

  // Each toggle says what pressing it will do.
  const reflect = () => {
    const dark = current() === "dark";
    for (const button of document.querySelectorAll(".theme-toggle")) {
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("aria-pressed", String(dark));
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll(".theme-toggle")) {
      button.addEventListener("click", () => {
        const next = current() === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // not remembered, but still switched for now
        }
        reflect();
      });
    }
    systemDark.addEventListener("change", reflect);
    reflect();
  });
}
