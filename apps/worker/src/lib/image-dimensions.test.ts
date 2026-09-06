import { describe, expect, it } from "vitest";
import { imageDimensions } from "./image-dimensions";

describe("imageDimensions", () => {
  it("reads a PNG's IHDR", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    expect(imageDimensions(png)).toEqual({ width: 1, height: 1 });
  });

  it("reads a JPEG's SOF0 frame header, skipping APP segments", () => {
    // SOI, APP0 (JFIF, 16 bytes), SOF0 with height 480 / width 640, then SOS.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
      Buffer.from([0xff, 0xda, 0x00, 0x0c]),
    ]);
    expect(imageDimensions(jpeg)).toEqual({ width: 640, height: 480 });
  });

  it("reads WebP VP8X extended headers", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    // canvas width-1 = 799, height-1 = 599, 24-bit little-endian
    webp[24] = 0x1f;
    webp[25] = 0x03;
    webp[26] = 0x00;
    webp[27] = 0x57;
    webp[28] = 0x02;
    webp[29] = 0x00;
    expect(imageDimensions(webp)).toEqual({ width: 800, height: 600 });
  });

  it("returns undefined for anything it cannot read, rather than guessing", () => {
    expect(imageDimensions(Buffer.from("%PDF-1.4"))).toBeUndefined();
    expect(imageDimensions(Buffer.alloc(0))).toBeUndefined();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x0c, 0, 0, 0, 0, 0, 0]))).toBeUndefined();
  });
});
