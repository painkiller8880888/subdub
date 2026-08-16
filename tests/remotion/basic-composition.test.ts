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
  audioTrackSequenceProps,
  audioTrackVolumeAtFrame,
  soundEffectSequenceProps
} from "../../src/remotion/audio.js";
import {
  renderManifestSchema,
  type RenderManifest
} from "../../src/schema/index.js";
import { browserExecutable as resolveBrowserExecutable } from "../../src/app/rendering/remotion-mp4-renderer.js";
import {
  findCharacterVariant,
  selectCharacterImagePathForFrame,
  selectCharacterImageSlotForFrame,
  selectActiveBackground,
  selectActiveInsert,
  selectActiveLines,
  selectActiveVisuals,
  selectCharacterVariantForFrame
} from "../../src/remotion/selection.js";
import {
  characterLayerStyle,
  resolveCharacterThemeColor,
  resolveSubtitleContent,
  SUBTITLE_SAFE_AREA_PX,
  SUBTITLE_SAFE_AREA_HEIGHT_PX,
  subtitleTypographyScale,
  subtitleContainerStyle
} from "../../src/remotion/layout-helpers.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const remotionEntryPoint = path.join(
  repositoryRoot,
  "src",
  "remotion",
  "entry-point.tsx"
);
const browserExecutable = resolveBrowserExecutable();

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
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "effect-1s.wav"),
    path.join(mediaDir, "effect-1s.wav")
  );
  await cp(
    path.join(repositoryRoot, "tests", "fixtures", "media", "effect-2s.wav"),
    path.join(mediaDir, "effect-2s.wav")
  );
  testRoot = root;
  return temporaryPublicDir;
}

async function renderFixtureFrame(
  frame: number,
  name: string,
  props: Record<string, unknown> = inputProps
): Promise<Buffer> {
  if (bundleDirectory === undefined || composition === undefined) {
    throw new Error("Remotion bundle has not been initialized");
  }
  if (outputDirectory === undefined) {
    throw new Error("Remotion output directory has not been initialized");
  }

  const selectedComposition =
    props === inputProps
      ? composition
      : await selectComposition({
          serveUrl: bundleDirectory,
          id: "BasicRemotionComposition",
          inputProps: props,
          browserExecutable
        });
  if (selectedComposition === undefined) {
    throw new Error("Remotion composition could not be selected");
  }

  const output = path.join(outputDirectory, `${name}.png`);
  await renderStill({
    serveUrl: bundleDirectory,
    composition: selectedComposition,
    inputProps: props,
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

async function warningPixelsInRegion(
  buffer: Buffer,
  region: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
): Promise<number> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor(info.width * region.left);
  const right = Math.ceil(info.width * region.right);
  const top = Math.floor(info.height * region.top);
  const bottom = Math.ceil(info.height * region.bottom);
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * info.width + x) * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      const alpha = data[offset + 3] ?? 0;
      if (
        red >= 225 &&
        green >= 60 &&
        green <= 110 &&
        blue >= 60 &&
        blue <= 110 &&
        alpha > 200
      ) {
        count += 1;
      }
    }
  }

  return count;
}

async function differentPixelsInRegion(
  first: Buffer,
  second: Buffer,
  region: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
): Promise<number> {
  const [firstImage, secondImage] = await Promise.all([
    sharp(first).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(second).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  ]);
  expect(firstImage.info.width).toBe(secondImage.info.width);
  expect(firstImage.info.height).toBe(secondImage.info.height);

  const left = Math.floor(firstImage.info.width * region.left);
  const right = Math.ceil(firstImage.info.width * region.right);
  const top = Math.floor(firstImage.info.height * region.top);
  const bottom = Math.ceil(firstImage.info.height * region.bottom);
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * firstImage.info.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (
          firstImage.data[offset + channel] !==
          secondImage.data[offset + channel]
        ) {
          count += 1;
          break;
        }
      }
    }
  }

  return count;
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

  it("selects closed and open mouth slots at deterministic speech boundaries", () => {
    const mentor = manifest.characters.find(
      (character) => character.characterId === "character-mentor"
    );
    const learner = manifest.characters.find(
      (character) => character.characterId === "character-learner"
    );
    if (mentor === undefined || learner === undefined) {
      throw new Error("character fixture is incomplete");
    }

    expect(selectCharacterImageSlotForFrame(manifest, mentor, 60)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 62)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 63)).toBe("open");
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 66)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 100)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 105)).toBe(
      "single"
    );

    // The learner line has a three-frame pause before speech and a pause after
    // speech while its mouth-pair variant remains selected.
    expect(selectCharacterImageSlotForFrame(manifest, learner, 105)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, learner, 107)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, learner, 108)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, learner, 111)).toBe(
      "open"
    );
    expect(selectCharacterImageSlotForFrame(manifest, learner, 143)).toBe(
      "closed"
    );
    expect(selectCharacterImageSlotForFrame(manifest, learner, 145)).toBe(
      "single"
    );

    const repeated = Array.from({ length: 24 }, (_, offset) =>
      selectCharacterImageSlotForFrame(manifest, mentor, 60 + offset)
    );
    expect(repeated).toEqual(
      Array.from({ length: 24 }, (_, offset) =>
        selectCharacterImageSlotForFrame(manifest, mentor, 60 + offset)
      )
    );
  });

  it("moves only the speaking character and never invents a single-image mouth pair", () => {
    const mentor = manifest.characters[0];
    const learner = manifest.characters[1];
    if (mentor === undefined || learner === undefined) {
      throw new Error("character fixture is incomplete");
    }

    expect(
      selectCharacterVariantForFrame(manifest, mentor, 63)?.variantId
    ).toBe("character-mentor-speak-pointing-v1");
    expect(selectCharacterImageSlotForFrame(manifest, mentor, 63)).toBe("open");
    expect(
      selectCharacterVariantForFrame(manifest, learner, 63)?.variantId
    ).toBe(learner.idleVariantId);
    expect(selectCharacterImageSlotForFrame(manifest, learner, 63)).toBe(
      "single"
    );
    expect(selectCharacterImagePathForFrame(manifest, mentor, 60)).toMatch(
      /\/closed\.png$/
    );
    expect(selectCharacterImagePathForFrame(manifest, mentor, 63)).toMatch(
      /\/open\.png$/
    );
    expect(selectCharacterImagePathForFrame(manifest, learner, 63)).toMatch(
      /\/stand\.png$/
    );
  });

  it("renders the manifest speaker label and keeps subtitle geometry in the safe area", () => {
    const line = manifest.lines.find(
      (candidate) => candidate.id === "main-learner-1"
    );
    if (line === undefined) {
      throw new Error("long learner subtitle fixture is missing");
    }
    const subtitle = resolveSubtitleContent(manifest, line);
    expect(subtitle.displayName).toBe("ずんだもん");
    expect(subtitle.speakerColor).toBe(
      resolveCharacterThemeColor("character.zundamon")
    );
    expect(subtitle.subtitleText).toBe(line.subtitleText);
    expect(subtitle.side).toBe("right");
    expect(
      subtitleTypographyScale(subtitle.displayName, subtitle.subtitleText)
    ).toBe(1);

    const side = subtitleContainerStyle(subtitle.side);
    expect(side).toMatchObject({
      left: SUBTITLE_SAFE_AREA_PX,
      right: SUBTITLE_SAFE_AREA_PX,
      top: SUBTITLE_SAFE_AREA_PX,
      bottom: SUBTITLE_SAFE_AREA_PX,
      boxSizing: "border-box",
      justifyContent: "flex-end"
    });
    expect(subtitleContainerStyle("left")).toMatchObject({
      left: SUBTITLE_SAFE_AREA_PX,
      right: SUBTITLE_SAFE_AREA_PX,
      top: SUBTITLE_SAFE_AREA_PX,
      bottom: SUBTITLE_SAFE_AREA_PX
    });
  });

  it("keeps character geometry independent of the selected mouth slot", () => {
    const closedStyle = characterLayerStyle(0, false, "character.metan");
    const openStyle = characterLayerStyle(0, false, "character.metan");
    expect(openStyle).toEqual(closedStyle);
    expect(closedStyle).toMatchObject({
      left: "4%",
      bottom: 124,
      width: "25%",
      height: "48%",
      objectFit: "contain",
      objectPosition: "bottom center"
    });
  });

  it("selects opening, eye catch, and ending placeholders as half-open intervals", () => {
    const manifest = renderManifestFixture as RenderManifest;

    expect(selectActiveInsert(manifest, 0)?.slot).toBe("opening");
    expect(selectActiveInsert(manifest, 59)?.slot).toBe("opening");
    expect(selectActiveInsert(manifest, 60)).toBeUndefined();
    expect(selectActiveInsert(manifest, 149)).toBeUndefined();
    expect(selectActiveInsert(manifest, 150)?.slot).toBe("eye_catch");
    expect(selectActiveInsert(manifest, 209)?.slot).toBe("eye_catch");
    expect(selectActiveInsert(manifest, 210)).toBeUndefined();
    expect(selectActiveInsert(manifest, 420)?.slot).toBe("ending");
    expect(selectActiveInsert(manifest, 479)?.slot).toBe("ending");
    expect(selectActiveInsert(manifest, 480)).toBeUndefined();
  });

  it("maps manifest audio tracks to bounded sequences and deterministic fades", () => {
    const track = renderManifestFixture.audioTracks[1];
    const effect = renderManifestFixture.soundEffects[0];
    if (track === undefined || effect === undefined) {
      throw new Error("audio fixture is incomplete");
    }

    expect(audioTrackSequenceProps(track)).toMatchObject({
      from: track.from,
      durationInFrames: track.durationInFrames,
      loop: true
    });
    expect(audioTrackSequenceProps(track).src).toContain(track.src);
    expect(soundEffectSequenceProps(effect)).toMatchObject({
      from: effect.from,
      durationInFrames: effect.durationInFrames,
      volume: effect.volume
    });
    expect(soundEffectSequenceProps(effect).src).toContain(effect.src);

    expect(audioTrackVolumeAtFrame(track, 0)).toBe(0);
    expect(audioTrackVolumeAtFrame(track, 4)).toBeCloseTo(
      track.volume * (4 / track.fadeInFrames),
      10
    );
    expect(audioTrackVolumeAtFrame(track, track.fadeInFrames)).toBe(
      track.volume
    );
    expect(
      audioTrackVolumeAtFrame(track, track.durationInFrames - 1)
    ).toBeCloseTo(track.volume / track.fadeOutFrames, 10);
    expect(audioTrackVolumeAtFrame(track, track.durationInFrames)).toBe(0);

    const overlappingFade = {
      ...track,
      durationInFrames: 10,
      volume: 0.8,
      fadeInFrames: 10,
      fadeOutFrames: 10
    };
    expect(audioTrackVolumeAtFrame(overlappingFade, 5)).toBe(0.2);
    expect(audioTrackVolumeAtFrame(overlappingFade, 5)).toBeLessThanOrEqual(
      overlappingFade.volume
    );

    const noFade = { ...track, fadeInFrames: 0, fadeOutFrames: 0 };
    expect(audioTrackVolumeAtFrame(noFade, 0)).toBe(noFade.volume);
    expect(audioTrackVolumeAtFrame(noFade, noFade.durationInFrames)).toBe(
      noFade.volume
    );
  });
});

describe("basic Remotion composition", () => {
  beforeAll(async () => {
    if (browserExecutable === undefined) {
      throw new Error(
        "A local Chrome/Chromium/Edge executable is required for the offline Remotion still test"
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
      { frame: 260, name: "long-subtitle" },
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
    const photo = rendered.find((result) => result.frame === 220);
    if (photo === undefined) {
      throw new Error("photo still was not rendered");
    }
    expect(
      await warningPixelsInRegion(photo.buffer, {
        left: 0.2,
        right: 0.75,
        top: 0.25,
        bottom: 0.5
      })
    ).toBeGreaterThan(20);
    // The triangle's top fringe is outside the 5px line and proves the arrowhead is rendered.
    expect(
      await warningPixelsInRegion(photo.buffer, {
        left: 0.44,
        right: 0.47,
        top: 0.35,
        bottom: 0.372
      })
    ).toBeGreaterThan(0);
    const repeat = await renderFixtureFrame(80, "video-repeat");
    const first = rendered[0];
    if (first === undefined) {
      throw new Error("video still was not rendered");
    }
    expect(repeat.equals(first.buffer)).toBe(true);

    const closed = await renderFixtureFrame(210, "mentor-closed");
    const open = await renderFixtureFrame(213, "mentor-open");
    expect(
      await differentPixelsInRegion(closed, open, {
        left: 0,
        right: 0.35,
        top: 0.35,
        bottom: 0.95
      })
    ).toBeGreaterThan(0);
    expect(
      await differentPixelsInRegion(closed, open, {
        left: 0.65,
        right: 1,
        top: 0.35,
        bottom: 0.95
      })
    ).toBe(0);
  }, 180_000);

  it("renders placeholder frames as isolated labeled screens", async () => {
    const opening = await renderFixtureFrame(30, "placeholder-opening");
    const eyeCatch = await renderFixtureFrame(170, "placeholder-eye-catch");
    const ending = await renderFixtureFrame(450, "placeholder-ending");
    const content = await renderFixtureFrame(220, "placeholder-content");

    expect(
      await differentPixelsInRegion(opening, eyeCatch, {
        left: 0,
        right: 0.25,
        top: 0,
        bottom: 1
      })
    ).toBe(0);
    expect(
      await differentPixelsInRegion(eyeCatch, ending, {
        left: 0,
        right: 0.25,
        top: 0,
        bottom: 1
      })
    ).toBe(0);
    expect(
      await differentPixelsInRegion(eyeCatch, content, {
        left: 0,
        right: 0.25,
        top: 0,
        bottom: 1
      })
    ).toBeGreaterThan(0);
    expect(
      await differentPixelsInRegion(opening, eyeCatch, {
        left: 0.25,
        right: 0.75,
        top: 0.4,
        bottom: 0.6
      })
    ).toBeGreaterThan(0);
  }, 180_000);

  it("shrinks long multi-line subtitles so their rendered pixels stay in the safe area", async () => {
    const boundaryManifest = structuredClone(
      renderManifestRenderingFixture
    ) as RenderManifest;
    const boundaryLine = boundaryManifest.lines.find(
      (line) => line.id === "main-learner-1"
    );
    if (boundaryLine === undefined) {
      throw new Error("subtitle boundary fixture line is missing");
    }
    boundaryLine.subtitleText = [
      "あ".repeat(137),
      ...Array.from({ length: 12 }, () => "行")
    ].join("\n");
    expect(boundaryLine.subtitleText.length).toBe(161);
    expect(boundaryLine.subtitleText.split("\n")).toHaveLength(13);
    expect(renderManifestSchema.safeParse(boundaryManifest).success).toBe(true);
    const noSubtitleManifest = structuredClone(
      boundaryManifest
    ) as RenderManifest;
    const noSubtitleLine = noSubtitleManifest.lines.find(
      (line) => line.id === "main-learner-1"
    );
    if (noSubtitleLine === undefined) {
      throw new Error("subtitle boundary comparison line is missing");
    }
    noSubtitleLine.subtitleText = "";

    const withSubtitle = await renderFixtureFrame(
      260,
      "subtitle-safe-area-boundary",
      boundaryManifest as unknown as Record<string, unknown>
    );
    const withoutSubtitle = await renderFixtureFrame(
      260,
      "subtitle-safe-area-boundary-empty",
      noSubtitleManifest as unknown as Record<string, unknown>
    );

    expect(
      subtitleTypographyScale(
        boundaryManifest.characters[1]?.displayName ?? "",
        boundaryLine.subtitleText
      )
    ).toBeLessThan(1);
    expect(
      await differentPixelsInRegion(withSubtitle, withoutSubtitle, {
        left: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.width,
        right:
          (renderManifestRenderingFixture.width - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.width,
        top: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.height,
        bottom:
          (renderManifestRenderingFixture.height - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.height
      })
    ).toBeGreaterThan(0);

    const outsideSafeArea = [
      {
        left: 0,
        right: 1,
        top: 0,
        bottom: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.height
      },
      {
        left: 0,
        right: 1,
        top:
          (renderManifestRenderingFixture.height - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.height,
        bottom: 1
      },
      {
        left: 0,
        right: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.width,
        top: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.height,
        bottom:
          (renderManifestRenderingFixture.height - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.height
      },
      {
        left:
          (renderManifestRenderingFixture.width - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.width,
        right: 1,
        top: SUBTITLE_SAFE_AREA_PX / renderManifestRenderingFixture.height,
        bottom:
          (renderManifestRenderingFixture.height - SUBTITLE_SAFE_AREA_PX) /
          renderManifestRenderingFixture.height
      }
    ];
    for (const region of outsideSafeArea) {
      expect(
        await differentPixelsInRegion(withSubtitle, withoutSubtitle, region)
      ).toBe(0);
    }

    expect(SUBTITLE_SAFE_AREA_HEIGHT_PX).toBe(
      renderManifestRenderingFixture.height - SUBTITLE_SAFE_AREA_PX * 2
    );
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
