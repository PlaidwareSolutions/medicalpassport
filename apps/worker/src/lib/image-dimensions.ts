/**
 * Pixel dimensions from an image header (PNG, JPEG, WebP), so OCR word boxes can be
 * normalized to 0–1 page coordinates (docs_v2/04 §7.5 `boundingBox`) without decoding the
 * image twice. Returns undefined for anything it cannot read; the OCR adapter then falls
 * back to the extent of the words it saw.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

export function imageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes);
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at]! << 8) + b[at + 1]!;
}

function u16le(b: Uint8Array, at: number): number {
  return b[at]! + (b[at + 1]! << 8);
}

function valid(width: number, height: number): ImageDimensions | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function png(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 24) return undefined;
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) return undefined;
  // IHDR is always the first chunk: length(4) "IHDR"(4) width(4) height(4).
  return valid(u32be(b, 16), u32be(b, 20));
}

function jpeg(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // length(2) precision(1) height(2) width(2)
      return valid(u16be(b, at + 7), u16be(b, at + 5));
    }
    if (marker === 0xda) return undefined; // start of scan without a frame header
    at += 2 + length;
  }
  return undefined;
}

function webp(b: Uint8Array): ImageDimensions | undefined {
  if (b.length < 30) return undefined;
  const tag = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return undefined;
  const chunk = tag(12);
  if (chunk === "VP8 ") return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    const width = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const height = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return valid(width, height);
  }
  return undefined;
}
