import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { describe, expect, it, afterAll, beforeAll } from "vitest";

import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { renderManifestRenderingFixture } from "../fixtures/render-manifest-rendering.js";
import {
  renderManifestSchema,
  type RenderManifest
} from "../../src/schema/index.js";
import {
  findCharacterVariant,
  selectActiveBackground,
  selectActiveLines,
  selectActiveVisuals,
  selectCharacterVariantForFrame
} from "../../src/remotion/selection.js";

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
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].find(
  (candidate): candidate is string =>
    candidate !== undefined && existsSync(candidate)
);

let testRoot: string | undefined;
let bundleDirectory: string | undefined;
let outputDirectory: string | undefined;
let composition: Awaited<ReturnType<typeof selectComposition>> | undefined;

const inputProps = renderManifestRenderingFixture as unknown as Record<
  string,
  unknown
>;

async function preparePublicDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "subdub-remotion-"));
  const temporaryPublicDir = path.join(root, "public");
  const mediaDir = path.join(temporaryPublicDir, "media");
  await mkdir(mediaDir, { recursive: true });
  await mkdir(path.join(temporaryPublicDir, "backgrounds"), {
    recursive: true
  });
  await cp(
    path.join(repositoryRoot, "public", "shared-assets"),
    path.join(temporaryPublicDir, "shared-assets"),
    { recursive: true }
  );
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "clip.mp4"),
    path.join(mediaDir, "clip.mp4")
  );
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "oriented.jpg"),
    path.join(mediaDir, "oriented.jpg")
  );
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "scan-3pages.pdf"),
    path.join(mediaDir, "scan-3pages.pdf")
  );
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "shot.png"),
    path.join(mediaDir, "shot.png")
  );
  testRoot = root;
  return temporaryPublicDir;
}

async function renderFixtureFrame(
  frame: number,
  name: string
): Promise<Buffer> {
  if (bundleDirectory === undefined || composition === undefined) {
    throw new Error("Remotion bundle has not been initialized");
  }
  if (outputDirectory === undefined) {
    throw new Error("Remotion output directory has not been initialized");
  }

  const output = path.join(outputDirectory, `${name}.png`);
  await renderStill({
    serveUrl: bundleDirectory,
    composition,
    inputProps,
    browserExecutable,
    frame,
    imageFormat: "png",
    output,
    overwrite: true,
    logLevel: "error"
  });
  return readFile(output);
}

async function imageStats(buffer: Buffer): Promise<{
  width: number | undefined;
  height: number | undefined;
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
    if ((data[offset + 3] ?? 0) > 0) {
      nonTransparentPixels += 1;
    }
    if (colors.size < 16) {
      colors.add(
        `${data[offset] ?? 0},${data[offset + 1] ?? 0},${data[offset + 2] ?? 0},${data[offset + 3] ?? 0}`
      );
    }
  }
  return {
    width: info.width,
    height: info.height,
    nonTransparentPixels,
    distinctColors: colors.size
  };
}

describe("RenderManifest interval selection", () => {
  const manifest = renderManifestFixture as RenderManifest;

  it("uses half-open frame boundaries for backgrounds, visuals, and lines", () => {
    expect(selectActiveBackground(manifest, 60)?.sectionId).toBe(
      "section-intro"
    );
    expect(selectActiveBackground(manifest, 145)).toBeUndefined();
    expect(
      selectActiveVisuals(manifest, 60).map((visual) => visual.id)
    ).toEqual(["visual-intro-video"]);
    expect(selectActiveVisuals(manifest, 145)).toEqual([]);
    expect(selectActiveLines(manifest, 104).map((line) => line.id)).toEqual([
      "intro-mentor-1"
    ]);
    expect(selectActiveLines(manifest, 105).map((line) => line.id)).toEqual([
      "intro-learner-1"
    ]);
  });

  it("uses the line variant only during that speaker's line interval", () => {
    const mentor = manifest.characters.find(
      (character) => character.characterId === "character-mentor"
    );
    if (mentor === undefined) {
      throw new Error("mentor fixture character is missing");
    }

    expect(
      selectCharacterVariantForFrame(manifest, mentor, 60)?.variantId
    ).toBe("character-mentor-speak-pointing-v1");
    expect(
      selectCharacterVariantForFrame(manifest, mentor, 150)?.variantId
    ).toBe(mentor.idleVariantId);
    expect(
      findCharacterVariant(manifest, mentor.idleVariantId)?.renderType
    ).toBe("single-image");
  });
});

describe("basic Remotion composition", () => {
  beforeAll(async () => {
    if (browserExecutable === undefined) {
      throw new Error(
        "A local Chrome/Edge executable is required for the offline Remotion still test"
      );
    }
    expect(
      renderManifestSchema.safeParse(renderManifestRenderingFixture).success
    ).toBe(true);
    const temporaryPublicDir = await preparePublicDirectory();
    outputDirectory = path.join(testRoot ?? os.tmpdir(), "stills");
    await mkdir(outputDirectory, { recursive: true });
    const bundled = await bundle({
      entryPoint: remotionEntryPoint,
      publicDir: temporaryPublicDir,
      onProgress: () => undefined
    });
    bundleDirectory = bundled;
    composition = await selectComposition({
      serveUrl: bundled,
      id: "BasicRemotionComposition",
      inputProps,
      browserExecutable
    });
  }, 180_000);

  afterAll(async () => {
    if (bundleDirectory !== undefined) {
      await rm(bundleDirectory, { recursive: true, force: true });
    }
    if (testRoot !== undefined) {
      await rm(testRoot, { recursive: true, force: true });
    }
  });

  it("renders representative video, photo, and requested document-page stills deterministically", async () => {
    const frames = [
      { frame: 80, name: "video" },
      { frame: 220, name: "photo" },
      { frame: 390, name: "document" }
    ];
    const rendered = [] as Array<{
      frame: number;
      buffer: Buffer;
      stats: Awaited<ReturnType<typeof imageStats>>;
    }>;
    for (const entry of frames) {
      const buffer = await renderFixtureFrame(entry.frame, entry.name);
      rendered.push({
        frame: entry.frame,
        buffer,
        stats: await imageStats(buffer)
      });
    }

    for (const result of rendered) {
      expect(result.stats.width).toBe(renderManifestRenderingFixture.width);
      expect(result.stats.height).toBe(renderManifestRenderingFixture.height);
      expect(result.stats.nonTransparentPixels).toBeGreaterThan(0);
      expect(result.stats.distinctColors).toBeGreaterThan(1);
    }

    expect(
      renderManifestRenderingFixture.visuals.find(
        (visual) => visual.kind === "document_scan"
      )?.display.page
    ).toBe(2);
    const repeat = await renderFixtureFrame(80, "video-repeat");
    const first = rendered[0];
    if (first === undefined) {
      throw new Error("video still was not rendered");
    }
    expect(repeat.equals(first.buffer)).toBe(true);
  }, 180_000);
});

describe("composition dependency boundary", () => {
  it("does not import runtime catalog, compiler, database, filesystem, or audio analysis code", async () => {
    const remotionDirectory = path.join(repositoryRoot, "src", "remotion");
    const entries = await readdir(remotionDirectory, { withFileTypes: true });
    const source = (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
          .map((entry) =>
            readFile(path.join(remotionDirectory, entry.name), "utf8")
          )
      )
    ).join("\n");

    expect(source).not.toMatch(
      /better-sqlite3|drizzle-orm|render-manifest-compiler|characterVariantCatalog|node:(fs|path)|audioDuration|measureAudio/i
    );
  });
});
