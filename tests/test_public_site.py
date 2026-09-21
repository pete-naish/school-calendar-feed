"""The public landing page (docs/) must not make a visitor's browser talk to
anyone but this site: every request from a parent's browser to a third party
tells that party their IP address and that they looked at a school calendar.
Fonts are served from docs/assets/fonts/ rather than Google Fonts for that
reason; this keeps it that way."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

import pytest

DOCS = Path(__file__).resolve().parent.parent / "docs"
INDEX = (DOCS / "index.html").read_text()
CSS = (DOCS / "assets" / "calendar.css").read_text()
JS = (DOCS / "assets" / "calendar.js").read_text()
FONTS = DOCS / "assets" / "fonts"

# Hosts the page is still known to load something from. Empty is the goal.
# ical.js is imported from a CDN on line 1 of calendar.js: it should be
# vendored into docs/assets/ like the fonts (then delete this entry).
KNOWN_THIRD_PARTY_LOADS = {"cdn.jsdelivr.net": "ical.js, imported at the top of calendar.js"}


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


def test_page_loads_nothing_from_third_parties_beyond_the_known_ones():
    for name, hosts in _loaded_hosts().items():
        unexpected = hosts - set(KNOWN_THIRD_PARTY_LOADS)
        assert not unexpected, f"{name} loads from {sorted(unexpected)}"


def test_known_third_party_list_has_no_stale_entries():
    """Once ical.js is vendored, this fails until its entry is removed above."""
    actually_loaded = set().union(*_loaded_hosts().values())
    stale = set(KNOWN_THIRD_PARTY_LOADS) - actually_loaded
    assert not stale, f"no longer loaded, remove from KNOWN_THIRD_PARTY_LOADS: {sorted(stale)}"


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
