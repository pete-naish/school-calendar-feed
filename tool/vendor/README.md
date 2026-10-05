# Vendored third-party code

Served from the tool itself rather than a CDN: the tool's Content-Security-Policy
(`../_headers`) allows scripts from its own origin only, and it means the page
runs the script reviewed here and nothing else.

## qrcode-generator 2.0.4

Draws the QR code on the Share tab (`../page/share.ts`).

- File: `qrcode.js`, **unmodified** from the npm package `qrcode-generator@2.0.4`
  (`dist/qrcode.mjs`, an ES module - renamed to `.js` so it's served as
  JavaScript). Its own licence header is left intact.
- Licence: MIT, in `qrcode-generator-LICENSE.txt` (from the project's GitHub
  repository - the npm package doesn't include it).
- npm tarball integrity (from the registry, checked when this was added):
  `sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==`
- SHA-256 of `qrcode.js`: `ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0`
- `qrcode.d.ts` is ours: types for just the part the page uses.

The tests check the file against that SHA-256, so an accidental edit fails CI;
a deliberate upgrade means updating it here too.

### Upgrading

Dependabot can't see this file. It's a stable library with no network or
parsing surface (text in, a grid of squares out), so there's little reason to;
if you do:

1. Download `https://registry.npmjs.org/qrcode-generator/<version>`, read
   `dist.tarball` and `dist.integrity`, download the tarball and confirm its
   `sha512` (base64) matches `dist.integrity`.
2. Copy `package/dist/qrcode.mjs` over `qrcode.js`.
3. Update the version, integrity and SHA-256 above.
4. Open the Share tab and scan the QR code with a phone.
