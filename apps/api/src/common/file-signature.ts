/**
 * Verifies a file's actual magic-byte signature matches its declared
 * content type (docs/13 §13.4) — never trust the client's Content-Type
 * header alone.
 */
export function signatureMatches(contentType: string, header: Buffer): boolean {
  switch (contentType) {
    case "image/jpeg":
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case "image/png":
      return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
    case "image/heic":
      // ISO base media container: bytes 4-8 are "ftyp", brand follows.
      return header.subarray(4, 8).toString("ascii") === "ftyp";
    case "application/pdf":
      return header.subarray(0, 4).toString("ascii") === "%PDF";
    default:
      return false;
  }
}
