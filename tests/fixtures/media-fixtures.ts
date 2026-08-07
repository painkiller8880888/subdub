import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { AssetKind } from "../../src/schema/asset.js";

const MEDIA_ROOT = path.join(process.cwd(), "tests", "fixtures", "media");

async function load(fileName: string): Promise<Buffer> {
  return fs.readFile(path.join(MEDIA_ROOT, fileName));
}

export async function mediaFixture(fileName: string): Promise<Buffer> {
  return load(fileName);
}

export function mediaFixturePath(fileName: string): string {
  return path.join(MEDIA_ROOT, fileName);
}

export type MediaFixture = {
  fileName: string;
  kind: AssetKind;
  mimeType: string;
  expected: {
    width: number | null;
    height: number | null;
    durationMs: number | null;
    pageCount: number | null;
    thumbnailCount: number;
  };
};

export const realMediaFixtures: readonly MediaFixture[] = [
  {
    fileName: "clip.mp4",
    kind: "video",
    mimeType: "video/mp4",
    expected: {
      width: 320,
      height: 176,
      durationMs: 10027,
      pageCount: null,
      thumbnailCount: 1
    }
  },
  {
    fileName: "shot.png",
    kind: "photo",
    mimeType: "image/png",
    expected: {
      width: 64,
      height: 48,
      durationMs: null,
      pageCount: null,
      thumbnailCount: 1
    }
  },
  {
    fileName: "oriented.jpg",
    kind: "photo",
    mimeType: "image/jpeg",
    expected: {
      width: 32,
      height: 64,
      durationMs: null,
      pageCount: null,
      thumbnailCount: 1
    }
  },
  {
    fileName: "scan-3pages.pdf",
    kind: "document_scan",
    mimeType: "application/pdf",
    expected: {
      width: 200,
      height: 150,
      durationMs: null,
      pageCount: 3,
      thumbnailCount: 3
    }
  },
  {
    fileName: "effect-2s.wav",
    kind: "sound_effect",
    mimeType: "audio/wav",
    expected: {
      width: null,
      height: null,
      durationMs: 2000,
      pageCount: null,
      thumbnailCount: 0
    }
  }
];
