# Vendored third-party code

Served from this site rather than a CDN, so a visitor's browser makes no
request to anyone else (see `tests/test_public_site.py`) and can't be handed a
different script than the one reviewed here.

## ical.js 2.2.1

Parses the `.ics` feeds in the browser for the preview calendar
(`../calendar.js`).

- File: `ical.min.js`, **unmodified** from the npm package `ical.js@2.2.1`
  (`dist/ical.min.js`) - the same bytes jsDelivr served for it.
- Licence: MPL-2.0, in `ical.js-LICENSE.txt`. The file's own licence header is
  left intact.
- npm tarball integrity (from the registry, checked when this was added):
  `sha512-yK/UlPbEs316igb/tjRgbFA8ZV75rCsBJp/hWOatpyaPNlgw0dGDmU+FoicOcwX4xXkeXOkYiOmCqNPFpNPkQg==`
- SHA-256 of `ical.min.js`: `6643f20634241dc040e02c2f10e3c48cf9bcda4b3180f4321a3d05a3a83dfe52`

The test suite checks the file against that SHA-256, so an accidental edit
fails CI; a deliberate upgrade means updating it here too.

### Upgrading

Dependabot can't see this file, so check for a new release occasionally
(`npm view ical.js version`, or the [releases](https://github.com/kewisch/ical.js/releases)).

1. Download `https://registry.npmjs.org/ical.js/<version>` and read
   `dist.tarball` and `dist.integrity`; download the tarball and confirm its
   `sha512` (base64) matches `dist.integrity`.
2. Copy `package/dist/ical.min.js` and `package/LICENSE` over the files here.
3. Update the version, integrity and SHA-256 above.
4. Load the preview calendar and check that events, recurring events and
   moved occurrences still show.
