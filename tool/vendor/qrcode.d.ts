// Types for the vendored qrcode.js (qrcode-generator 2.0.4's dist/qrcode.mjs) -
// just the part page/share.ts uses. The package's own qrcode.d.ts declares a
// CommonJS-style global, which doesn't fit an ES module import.
export interface QRCode {
  addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

// typeNumber 0 picks the smallest size that fits.
declare function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): QRCode;
export default qrcode;
