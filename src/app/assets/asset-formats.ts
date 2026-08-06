import type { AssetKind } from "../../schema/asset.js";

export const ASSET_FORMATS = {
  mp4: {
    kind: "video" as const,
    mimeType: "video/mp4",
    extension: "mp4",
    label: "MP4"
  },
  png: {
    kind: "photo" as const,
    mimeType: "image/png",
    extension: "png",
    label: "PNG"
  },
  jpeg: {
    kind: "photo" as const,
    mimeType: "image/jpeg",
    extension: "jpg",
    label: "JPEG"
  },
  pdf: {
    kind: "document_scan" as const,
    mimeType: "application/pdf",
    extension: "pdf",
    label: "PDF"
  },
  wav: {
    kind: "sound_effect" as const,
    mimeType: "audio/wav",
    extension: "wav",
    label: "WAV"
  }
} as const;

export type AssetFormat = keyof typeof ASSET_FORMATS;

export type AssetFormatInfo = (typeof ASSET_FORMATS)[AssetFormat];

// Common MIME aliases per allowed format. The multipart Content-Type is
// advisory only; the detected file bytes are the source of truth. Aliases are
// normalized in a single registry so that e.g. WAV spellings map to one format.
export const ASSET_FORMAT_MIME_ALIASES: Record<AssetFormat, readonly string[]> =
  {
    mp4: ["video/mp4"],
    png: ["image/png"],
    jpeg: ["image/jpeg", "image/pjpeg"],
    pdf: ["application/pdf"],
    wav: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]
  };

export const ASSET_KIND_FORMATS: Record<AssetKind, readonly AssetFormat[]> = {
  video: ["mp4"],
  photo: ["png", "jpeg"],
  document_scan: ["pdf"],
  sound_effect: ["wav"]
};

export const ASSET_DETECTION_HEAD_BYTES = 64;

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

export type AssetFormatDetection =
  | { status: "matched"; format: AssetFormat }
  | { status: "unsupported" }
  | { status: "too_short" };

function hasBytes(head: Buffer, length: number): boolean {
  return head.length >= length;
}

function matches(head: Buffer, offset: number, expected: Buffer): boolean {
  return (
    hasBytes(head, offset + expected.length) &&
    head.subarray(offset, offset + expected.length).equals(expected)
  );
}

function matchesAscii(head: Buffer, offset: number, expected: string): boolean {
  return (
    hasBytes(head, offset + expected.length) &&
    head.subarray(offset, offset + expected.length).toString("latin1") ===
      expected
  );
}

function detectMp4(head: Buffer): boolean {
  // ISO Base Media File Format: the first box is ftyp (size + "ftyp").
  if (!hasBytes(head, 8)) {
    return false;
  }
  const size = head.readUInt32BE(0);
  return size >= 8 && matchesAscii(head, 4, "ftyp");
}

export function detectAssetFormat(head: Buffer): AssetFormatDetection {
  if (head.length === 0) {
    return { status: "too_short" };
  }

  if (matches(head, 0, pngSignature)) {
    return { status: "matched", format: "png" };
  }

  // JPEG starts with the Start-Of-Image marker FF D8 FF.
  if (
    hasBytes(head, 3) &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return { status: "matched", format: "jpeg" };
  }

  if (matchesAscii(head, 0, "%PDF-")) {
    return { status: "matched", format: "pdf" };
  }

  // RIFF container with a WAVE form type at offset 8.
  if (matchesAscii(head, 0, "RIFF") && matchesAscii(head, 8, "WAVE")) {
    return { status: "matched", format: "wav" };
  }

  if (detectMp4(head)) {
    return { status: "matched", format: "mp4" };
  }

  if (head.length < 12) {
    return { status: "too_short" };
  }

  return { status: "unsupported" };
}

export function normalizeAssetMimeType(mimeType: string | undefined): string {
  if (mimeType === undefined) {
    return "";
  }
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function assetFormatForMimeType(
  mimeType: string | undefined
): AssetFormat | undefined {
  const normalized = normalizeAssetMimeType(mimeType);
  for (const format of Object.keys(
    ASSET_FORMAT_MIME_ALIASES
  ) as AssetFormat[]) {
    if (ASSET_FORMAT_MIME_ALIASES[format].includes(normalized)) {
      return format;
    }
  }
  return undefined;
}
