import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ThumbnailPlan } from "../../src/schema/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const remotionEntryPoint = path.join(
  repositoryRoot,
  "src",
  "remotion",
  "entry-point.tsx"
);
const browserExecutable = [
  process.env.CHROME_BIN,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(
  (candidate): candidate is string =>
    candidate !== undefined && existsSync(candidate)
);

const minimalThumbnail: ThumbnailPlan = {
  backgroundImage: null,
  title: "申請手順の基本",
  subtitle: null,
  departmentOrSystem: "総務部",
  manualVersion: null,
  characterId: null,
  representativeVisualPath: null,
  layout: "standard"
};

let publicDirectory: string | undefined;
let bundleDirectory: string | undefined;
let outputDirectory: string | undefined;

async function imageStats(buffer: Buffer): Promise<{
  width: number;
  height: number;
  nonTransparentPixels: number;
  distinctColors: number;
}> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set<string>();
  let nonTransparentPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    if (alpha > 0) {
      nonTransparentPixels += 1;
      if (colors.size < 128) {
        colors.add(
          `${data[offset] ?? 0},${data[offset + 1] ?? 0},${data[offset + 2] ?? 0},${alpha}`
        );
      }
    }
  }
  return {
    width: info.width,
    height: info.height,
    nonTransparentPixels,
    distinctColors: colors.size
  };
}

async function renderThumbnail(
  thumbnail: ThumbnailPlan,
  characterImagePath: string | null,
  name: string
): Promise<Buffer> {
  if (bundleDirectory === undefined || outputDirectory === undefined) {
    throw new Error("thumbnail Remotion test has not been initialized");
  }
  const inputProps = { thumbnail, characterImagePath };
  const composition = await selectComposition({
    serveUrl: bundleDirectory,
    id: "StandardThumbnailComposition",
    inputProps,
    browserExecutable
  });
  expect(composition.width).toBe(1280);
  expect(composition.height).toBe(720);
  expect(composition.fps).toBe(30);
  expect(composition.durationInFrames).toBe(1);

  const output = path.join(outputDirectory, `${name}.png`);
  await renderStill({
    serveUrl: bundleDirectory,
    composition,
    inputProps,
    browserExecutable,
    frame: 0,
    imageFormat: "png",
    output,
    overwrite: true,
    logLevel: "error"
  });
  return readFile(output);
}

describe("standard thumbnail composition", () => {
  beforeAll(async () => {
    if (browserExecutable === undefined) {
      throw new Error(
        "A local Chrome/Edge executable is required for the offline thumbnail still test"
      );
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "subdub-thumbnail-"));
    publicDirectory = path.join(root, "public");
    outputDirectory = path.join(root, "output");
    await mkdir(outputDirectory, { recursive: true });
    await cp(
      path.join(repositoryRoot, "public", "shared-assets"),
      path.join(publicDirectory, "shared-assets"),
      { recursive: true }
    );
    await mkdir(path.join(publicDirectory, "media"), { recursive: true });
    await mkdir(path.join(publicDirectory, "thumbnail"), {
      recursive: true
    });
    await cp(
      path.join(repositoryRoot, "tests", "fixtures", "media", "oriented.jpg"),
      path.join(publicDirectory, "media", "representative.jpg")
    );
    await cp(
      path.join(repositoryRoot, "tests", "fixtures", "media", "shot.png"),
      path.join(publicDirectory, "thumbnail", "background.png")
    );
    bundleDirectory = await bundle({
      entryPoint: remotionEntryPoint,
      publicDir: publicDirectory,
      onProgress: () => undefined
    });
  }, 180_000);

  afterAll(async () => {
    if (bundleDirectory !== undefined) {
      await rm(bundleDirectory, { recursive: true, force: true });
    }
    if (publicDirectory !== undefined) {
      await rm(path.dirname(publicDirectory), { recursive: true, force: true });
    }
  });

  it("renders a non-empty 1280x720 PNG when all optional fields are null", async () => {
    const buffer = await renderThumbnail(minimalThumbnail, null, "minimal");
    const stats = await imageStats(buffer);
    expect(stats).toMatchObject({ width: 1280, height: 720 });
    expect(stats.nonTransparentPixels).toBeGreaterThan(0);
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect((await sharp(buffer).metadata()).format).toBe("png");
  }, 180_000);

  it("renders required text and every optional asset without throwing", async () => {
    const withOptionalFields: ThumbnailPlan = {
      backgroundImage: "thumbnail/background.png",
      title: "社内申請の登録手順",
      subtitle: "新規申請を迷わず登録する",
      departmentOrSystem: "社内申請システム",
      manualVersion: "2026.08",
      characterId: "character-mentor",
      representativeVisualPath: "media/representative.jpg",
      layout: "standard"
    };
    const complete = await renderThumbnail(
      withOptionalFields,
      "shared-assets/characters/character-mentor/stand/stand.png",
      "complete"
    );
    const requiredTextVariant = await renderThumbnail(
      {
        ...minimalThumbnail,
        title: "別のタイトル",
        departmentOrSystem: "別のシステム"
      },
      null,
      "required-text"
    );
    const stats = await imageStats(complete);
    expect(stats.nonTransparentPixels).toBeGreaterThan(0);
    expect(stats.distinctColors).toBeGreaterThan(1);
    expect(complete.equals(requiredTextVariant)).toBe(false);
  }, 180_000);

  it("produces the same pixels for the same input", async () => {
    const first = await renderThumbnail(minimalThumbnail, null, "repeat-1");
    const second = await renderThumbnail(minimalThumbnail, null, "repeat-2");
    expect(second.equals(first)).toBe(true);
  }, 180_000);
});
