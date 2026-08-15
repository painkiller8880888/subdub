import { describe, expect, it } from "vitest";

import {
  ASSET_FORMATS,
  ASSET_KIND_FORMATS,
  assetFormatForMimeType,
  detectAssetFormat,
  normalizeAssetMimeType
} from "../../src/app/assets/asset-formats.js";
import {
  jpegBytes,
  mp3Bytes,
  mp4Bytes,
  pdfBytes,
  pngBytes,
  wavBytes
} from "../fixtures/asset-fixtures.js";

describe("asset format detection", () => {
  it("detects each allowed format from its signature", () => {
    expect(detectAssetFormat(pngBytes)).toEqual({
      status: "matched",
      format: "png"
    });
    expect(detectAssetFormat(jpegBytes)).toEqual({
      status: "matched",
      format: "jpeg"
    });
    expect(detectAssetFormat(pdfBytes)).toEqual({
      status: "matched",
      format: "pdf"
    });
    expect(detectAssetFormat(wavBytes)).toEqual({
      status: "matched",
      format: "wav"
    });
    expect(detectAssetFormat(mp4Bytes)).toEqual({
      status: "matched",
      format: "mp4"
    });
    expect(detectAssetFormat(mp3Bytes)).toEqual({
      status: "matched",
      format: "mp3"
    });
    expect(
      detectAssetFormat(Buffer.from([0xff, 0xfb, 0x90, 0x64]))
    ).toEqual({
      status: "matched",
      format: "mp3"
    });
  });

  it("rejects empty, short, and unsupported heads", () => {
    expect(detectAssetFormat(Buffer.alloc(0))).toEqual({ status: "too_short" });
    expect(detectAssetFormat(Buffer.from([0x89, 0x50, 0x4e]))).toEqual({
      status: "too_short"
    });
    expect(detectAssetFormat(Buffer.from("GIF89a", "latin1"))).toEqual({
      status: "too_short"
    });
    expect(
      detectAssetFormat(Buffer.from("this is not a recognized file", "latin1"))
    ).toEqual({ status: "unsupported" });
  });

  it("detects a valid format even from a short but sufficient head", () => {
    expect(detectAssetFormat(Buffer.from("%PDF-", "latin1"))).toEqual({
      status: "matched",
      format: "pdf"
    });
    expect(detectAssetFormat(jpegBytes.subarray(0, 3))).toEqual({
      status: "matched",
      format: "jpeg"
    });
    expect(detectAssetFormat(Buffer.from("ID3", "latin1"))).toEqual({
      status: "matched",
      format: "mp3"
    });
  });

  it("does not confuse one format for another", () => {
    const pdfHead = Buffer.concat([pdfBytes, pngBytes]);
    expect(detectAssetFormat(pdfHead)).toEqual({
      status: "matched",
      format: "pdf"
    });
    const wavHead = Buffer.concat([wavBytes, pngBytes]);
    expect(detectAssetFormat(wavHead)).toEqual({
      status: "matched",
      format: "wav"
    });
  });

  it("normalizes declared MIME aliases", () => {
    expect(normalizeAssetMimeType("audio/wav")).toBe("audio/wav");
    expect(normalizeAssetMimeType("audio/x-wav; charset=binary")).toBe(
      "audio/x-wav"
    );
    expect(normalizeAssetMimeType("AUDIO/WAVE")).toBe("audio/wave");
    expect(normalizeAssetMimeType(undefined)).toBe("");
  });

  it("maps allowed MIME aliases to a single format", () => {
    expect(assetFormatForMimeType("audio/wav")).toBe("wav");
    expect(assetFormatForMimeType("audio/x-wav")).toBe("wav");
    expect(assetFormatForMimeType("audio/wave")).toBe("wav");
    expect(assetFormatForMimeType("audio/vnd.wave")).toBe("wav");
    expect(assetFormatForMimeType("audio/mpeg")).toBe("mp3");
    expect(assetFormatForMimeType("image/jpeg")).toBe("jpeg");
    expect(assetFormatForMimeType("image/pjpeg")).toBe("jpeg");
    expect(assetFormatForMimeType("image/png")).toBe("png");
    expect(assetFormatForMimeType("video/mp4")).toBe("mp4");
    expect(assetFormatForMimeType("application/pdf")).toBe("pdf");
    expect(assetFormatForMimeType("application/octet-stream")).toBeUndefined();
    expect(assetFormatForMimeType(undefined)).toBeUndefined();
  });

  it("keeps the per-kind allowlist in sync with the format registry", () => {
    for (const [kind, formats] of Object.entries(ASSET_KIND_FORMATS)) {
      for (const format of formats) {
        expect(ASSET_FORMATS[format].kind).toBe(kind);
      }
    }
  });
});
