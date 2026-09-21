"""The public landing page (docs/) must not make a visitor's browser talk to
anyone but this site: every request from a parent's browser to a third party
tells that party their IP address and that they looked at a school calendar.
Fonts are served from docs/assets/fonts/ rather than Google Fonts for that
reason; this keeps it that way."""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_ics  # noqa: E402

DOCS = Path(__file__).resolve().parent.parent / "docs"
INDEX = (DOCS / "index.html").read_text()
CSS = (DOCS / "assets" / "calendar.css").read_text()
JS = (DOCS / "assets" / "calendar.js").read_text()
ASSETS = DOCS / "assets"
FONTS = ASSETS / "fonts"
VENDOR = ASSETS / "vendor"


def _absolute_hosts(urls):
    hosts = set()
    for url in urls:
        if url.startswith("//"):
            url = "https:" + url
        if url.startswith(("http://", "https://")):
            hosts.add(urlparse(url).hostname)
    return hosts


def _loaded_hosts() -> dict[str, set[str]]:
    """{file: hosts it loads a resource from} - stylesheets, scripts, fonts,
    images, imports and fetches. Plain <a href> links (subscribe buttons, the
    school's own site) aren't loads, so aren't counted."""
    html_loads = re.findall(
        r"<(?:link|script|img|source|iframe|video|audio|embed|object)\b[^>]*?\b(?:href|src|data|srcset)\s*=\s*[\"']([^\"']+)",
        INDEX,
        re.I,
    )
    css_loads = lambda text: re.findall(r"@import\s+(?:url\()?[\"']?([^\"')\s;]+)", text, re.I) + re.findall(
        r"url\(\s*[\"']?([^\"')]+)", text, re.I
    )
    js_loads = re.findall(r"\bimport\s*(?:[\w*{}\s,]+from\s*)?\(?\s*[\"']([^\"']+)", JS) + re.findall(
        r"\bfetch\(\s*[\"'`]([^\"'`]+)", JS
    )
    return {
        "index.html": _absolute_hosts(html_loads + css_loads(INDEX)),
        "calendar.css": _absolute_hosts(css_loads(CSS)),
        "calendar.js": _absolute_hosts(js_loads),
    }


def test_no_google_fonts_anywhere():
    for name, text in {"index.html": INDEX, "calendar.css": CSS, "calendar.js": JS}.items():
        assert "fonts.googleapis.com" not in text, name
        assert "fonts.gstatic.com" not in text, name


def test_page_loads_nothing_from_third_parties():
    """Not fonts, not scripts (ical.js is vendored in assets/vendor/), nothing."""
    for name, hosts in _loaded_hosts().items():
        assert not hosts, f"{name} loads from {sorted(hosts)}"


def test_the_scanner_would_notice_a_cdn_import():
    """Guards the check above against a regex that quietly finds nothing."""
    js = 'import ICAL from "https://cdn.jsdelivr.net/npm/ical.js@2.2.1/dist/ical.min.js";'
    found = re.findall(r"\bimport\s*(?:[\w*{}\s,]+from\s*)?\(?\s*[\"']([^\"']+)", js)
    assert _absolute_hosts(found) == {"cdn.jsdelivr.net"}


FONT_FACES = re.findall(r"@font-face\s*\{(.*?)\}", CSS, re.S)


def _face(block: str, prop: str) -> str:
    return re.search(rf"{prop}:\s*([^;]+);", block).group(1).strip()


def test_every_font_the_page_names_has_a_local_face():
    families = {_face(block, "font-family").strip("\"'") for block in FONT_FACES}
    named = set(re.findall(r"font-family:\s*[^;]*?\"(Geist(?: Mono)?)\"", CSS + INDEX)) | set(
        re.findall(r"--(?:sans|mono):\s*\"(Geist(?: Mono)?)\"", INDEX)
    )
    assert named == {"Geist", "Geist Mono"}
    assert named <= families


def test_each_font_face_points_at_a_real_woff2_file():
    assert len(FONT_FACES) == 4
    for block in FONT_FACES:
        src = re.search(r'url\("([^"]+)"\)\s*format\("woff2"\)', block)
        assert src, block
        path = DOCS / "assets" / src.group(1)
        assert path.is_file(), f"{src.group(1)} is missing"
        assert path.read_bytes()[:4] == b"wOF2", f"{path.name} isn't a woff2 file"
        assert path.stat().st_size > 5_000, f"{path.name} looks truncated"
        assert "font-display: swap" in block, "text should show in the fallback font while these load"


def test_the_latin_faces_cover_ordinary_english_text():
    for family in ("Geist", "Geist Mono"):
        latin = [b for b in FONT_FACES if _face(b, "font-family").strip("\"'") == family and "latin.woff2" in b]
        assert len(latin) == 1, family
        assert "U+0000-00FF" in _face(latin[0], "unicode-range")


def test_the_preloaded_font_exists_and_is_the_main_latin_face():
    preload = re.search(r'<link rel="preload" href="([^"]+)" as="font" type="font/woff2" crossorigin>', INDEX)
    assert preload, "preload needs crossorigin even for a same-origin font, or the browser fetches it twice"
    assert preload.group(1) == "assets/fonts/geist-latin.woff2"
    assert (DOCS / preload.group(1)).is_file()


def test_the_font_licence_ships_with_the_fonts():
    licence = (FONTS / "OFL.txt").read_text()
    assert "SIL Open Font License" in licence
    assert "Geist" in licence.splitlines()[0]


# --- vendored ical.js ---


def test_every_module_import_in_calendar_js_is_a_local_file():
    specifiers = re.findall(r"^import\b[^;]*?from\s*[\"']([^\"']+)[\"']", JS, re.M)
    assert "./vendor/ical.min.js" in specifiers
    for specifier in specifiers:
        assert specifier.startswith("./"), f"{specifier} isn't a local import"
        assert (ASSETS / specifier).is_file(), f"{specifier} is missing"


def test_vendored_ical_js_is_the_recorded_unmodified_file():
    recorded = re.search(r"SHA-256 of `ical\.min\.js`: `([0-9a-f]{64})`", (VENDOR / "README.md").read_text())
    assert recorded, "vendor/README.md must record the file's SHA-256"
    actual = hashlib.sha256((VENDOR / "ical.min.js").read_bytes()).hexdigest()
    assert actual == recorded.group(1), "ical.min.js was edited - if that was deliberate, update its record in vendor/README.md"


def test_vendored_ical_js_is_an_es_module_with_a_default_export():
    """calendar.js does `import ICAL from ...`, which needs one."""
    source = (VENDOR / "ical.min.js").read_text()
    assert re.search(r"export\s*\{[^}]*\bas default\b", source)
    assert source.startswith("/* This Source Code Form is subject to the terms of the Mozilla Public")


def test_the_vendored_licence_and_provenance_ship_with_it():
    assert "Mozilla Public License Version 2.0" in (VENDOR / "ical.js-LICENSE.txt").read_text()
    readme = (VENDOR / "README.md").read_text()
    assert "ical.js 2.2.1" in readme and "sha512-" in readme


# --- the page's own idea of which calendars exist ---

CONFIGURED_CODES = {cls["code"] for g in build_ics.YEAR_GROUPS for cls in g["classes"]}


def test_every_calendar_the_page_launches_is_a_configured_code():
    """A stale code here would quietly drop that calendar from the live page."""
    launched = re.search(r"const LAUNCHED_CALENDARS = new Set\(\[([^\]]*)\]\)", JS)
    assert launched, "LAUNCHED_CALENDARS not found"
    literals = set(re.findall(r'"([^"]+)"', launched.group(1)))
    assert literals, "the page should launch some class calendars"
    assert literals <= CONFIGURED_CODES, f"not class codes: {sorted(literals - CONFIGURED_CODES)}"


def test_saved_toggles_from_the_old_reception_codes_are_carried_over():
    """Returning visitors' ticked boxes on the preview were keyed by Reception's
    old codes (rr, rgp). That's saved browser state, not a feed subscription, so
    it's carried over to the classes those codes became."""
    shim = re.search(r"const LEGACY_TOGGLE_KEYS = \{([^}]*)\}", JS)
    assert shim, "LEGACY_TOGGLE_KEYS not found"
    mapping = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', shim.group(1)))
    assert mapping == {"rec-a": "rr", "rec-b": "rgp"}
    assert set(mapping) <= CONFIGURED_CODES


def test_the_page_lists_the_same_class_codes_and_labels_as_the_build():
    groups = re.findall(r'\{ label: "Year \d", dot: "[^"]+", colorVar: "[^"]+", classes: \[([^\]]*)\] \}', JS)
    reception = re.findall(r'label: "Reception"[^\n]*?classes: \[([^\]]*)\]', JS)
    pairs = [
        pair
        for chunk in reception + groups
        for pair in re.findall(r'code: "([^"]+)", label: "([^"]+)"', chunk)
    ]
    assert dict(pairs) == {cls["code"]: cls["current_label"] for g in build_ics.YEAR_GROUPS for cls in g["classes"]}
