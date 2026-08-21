import { describe, expect, it } from "vitest";

import {
  legacyRenderManifestV22Schema,
  renderManifestSchema,
  type RenderVisual,
  type RenderManifest
} from "../../src/schema/index.js";
import {
  renderManifestFixture,
  renderManifestFixtureV23
} from "../fixtures/render-manifest.js";

function clone(value: typeof renderManifestFixture): RenderManifest;
function clone<T>(value: T): T;
function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(
  value: unknown,
  expectedPath?: ReadonlyArray<string | number>
): void {
  const result = renderManifestSchema.safeParse(value);
  expect(result.success).toBe(false);

  if (result.success || expectedPath === undefined) {
    return;
  }

  expect(
    result.error.issues.some((issue) =>
      expectedPath.every((segment, index) => issue.path[index] === segment)
    )
  ).toBe(true);
}

function getVisualDisplayMetric(visual: RenderVisual): number {
  switch (visual.kind) {
    case "video":
      return visual.display.playbackRate;
    case "photo":
      return visual.display.outerFrame.rect.width;
    case "document_scan":
      return visual.display.page;
  }
}

describe("renderManifestSchema", () => {
  it("accepts the complete render manifest fixture", () => {
    const result = renderManifestSchema.safeParse(clone(renderManifestFixture));

    expect(result.success).toBe(true);
  });

  it("keeps the 2.2.0 muted parser separate from the 2.3.0 volume contract", () => {
    const legacy = structuredClone(renderManifestFixtureV23) as unknown as {
      manifestVersion: string;
      visuals: Array<{ display: Record<string, unknown> }>;
      audioTracks: Array<Record<string, unknown>>;
      inserts: Array<{
        id: string;
        role: "intro" | "outro" | "cutin";
        from: number;
        durationInFrames: number;
        src: string;
        volume: number;
      }>;
    };
    legacy.manifestVersion = "2.2.0";
    for (const track of legacy.audioTracks) {
      Object.assign(track, { fadeInFrames: 0, fadeOutFrames: 0 });
    }
    const legacyDisplay = legacy.visuals[0]?.display;
    if (legacyDisplay?.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    (legacyDisplay as unknown as { muted: boolean }).muted =
      legacyDisplay.volume === 0;
    Reflect.deleteProperty(legacyDisplay, "volume");
    legacy.inserts = legacy.inserts.map((insert) => ({
      id: insert.id,
      kind: "placeholder" as const,
      slot:
        insert.role === "intro"
          ? ("opening" as const)
          : insert.role === "outro"
            ? ("ending" as const)
            : ("eye_catch" as const),
      beforeSectionId: insert.role === "cutin" ? "section-main" : null,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      label: insert.role
    })) as unknown as typeof legacy.inserts;
    expect(legacyRenderManifestV22Schema.safeParse(legacy).success).toBe(true);
    expect(renderManifestSchema.safeParse(legacy).success).toBe(false);

    const projectDisplay = structuredClone(
      renderManifestFixtureV23
    ).visuals[0]?.display;
    if (projectDisplay?.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    Reflect.deleteProperty(projectDisplay, "volume");
    (projectDisplay as unknown as Record<string, unknown>).muted = true;
    const projectShape = clone(renderManifestFixture);
    (projectShape.visuals[0] as unknown as { display: unknown }).display =
      projectDisplay;
    expectInvalid(projectShape, ["visuals", 0, "display"]);
  });

  it("requires resolved character display metadata and positive lip sync periods", () => {
    const invalidToken = clone(renderManifestFixture);
    (invalidToken.characters[0] as unknown as { themeColorToken: string }).themeColorToken =
      "character.unknown";
    expectInvalid(invalidToken, ["characters", 0, "themeColorToken"]);

    const invalidPeriod = clone(renderManifestFixture);
    invalidPeriod.characters[0].lipSyncPeriodFrames = 0;
    expectInvalid(invalidPeriod, [
      "characters",
      0,
      "lipSyncPeriodFrames"
    ]);

    const unknownCharacterKey = clone(renderManifestFixture);
    Object.assign(unknownCharacterKey.characters[0], { unexpected: true });
    expectInvalid(unknownCharacterKey, ["characters", 0]);

    const missingVisualId = clone(renderManifestFixture);
    Reflect.deleteProperty(missingVisualId.characterVariants[0], "visualId");
    expectInvalid(missingVisualId, ["characterVariants", 0, "visualId"]);
  });

  it("allows multiple project characters to share one physical visual variant", () => {
    const shared = clone(renderManifestFixture);
    shared.characters[1].visualId = "character-mentor";
    shared.characters[1].idleVariantId = "character-mentor-stand-v1";
    shared.characterVariants = shared.characterVariants.filter(
      (variant) => variant.visualId === "character-mentor"
    );
    for (const line of shared.lines) {
      if (line.speakerId === "character-learner") {
        line.characterVariantId = "character-mentor-speak-normal-v1";
      }
    }

    expect(renderManifestSchema.safeParse(shared).success).toBe(true);
  });

  it("accepts long non-blank subtitle text from the source project", () => {
    const longSubtitle = clone(renderManifestFixture);
    longSubtitle.lines[0].subtitleText = [
      "あ".repeat(137),
      ...Array.from({ length: 12 }, () => "行")
    ].join("\n");

    expect(longSubtitle.lines[0].subtitleText.length).toBe(161);
    expect(longSubtitle.lines[0].subtitleText.split("\n")).toHaveLength(13);
    expect(renderManifestSchema.safeParse(longSubtitle).success).toBe(true);
  });

  it("does not accept the previous render manifest version", () => {
    const legacy = JSON.parse(JSON.stringify(renderManifestFixture)) as Record<
      string,
      unknown
    >;
    legacy.manifestVersion = "2.1.0";
    expectInvalid(legacy, ["manifestVersion"]);
  });

  it("rejects unknown keys at the root and in deep objects", () => {
    const rootUnknown = clone(renderManifestFixture);
    Object.assign(rootUnknown, { unexpected: true });
    expectInvalid(rootUnknown);

    const deepUnknown = clone(renderManifestFixture);
    Object.assign(deepUnknown.sourceAssetChecksums[0], { unexpected: true });
    expectInvalid(deepUnknown);
  });

  it("rejects non-positive, non-finite, and out-of-range values", () => {
    const invalidRootDuration = clone(renderManifestFixture);
    invalidRootDuration.durationInFrames = 0;
    expectInvalid(invalidRootDuration, ["durationInFrames"]);

    const invalidFrom = clone(renderManifestFixture);
    invalidFrom.lines[0].from = -1;
    expectInvalid(invalidFrom, ["lines", 0, "from"]);

    const invalidLineDuration = clone(renderManifestFixture);
    invalidLineDuration.lines[0].durationInFrames = 0;
    expectInvalid(invalidLineDuration, ["lines", 0, "durationInFrames"]);

    const legacyFadeField = clone(renderManifestFixture);
    Object.assign(legacyFadeField.audioTracks[0], { fadeInFrames: 0 });
    expectInvalid(legacyFadeField, ["audioTracks", 0]);

    const invalidLoop = clone(renderManifestFixture);
    (invalidLoop.audioTracks[0] as unknown as { loop: boolean }).loop = false;
    expectInvalid(invalidLoop, ["audioTracks", 0, "loop"]);

    const invalidVolume = clone(renderManifestFixture);
    invalidVolume.audioTracks[0].volume = 1.1;
    expectInvalid(invalidVolume, ["audioTracks", 0, "volume"]);

    const invalidFinite = clone(renderManifestFixture);
    invalidFinite.visuals[0].display.outerFrame.rect.width =
      Number.POSITIVE_INFINITY;
    expectInvalid(invalidFinite, [
      "visuals",
      0,
      "display",
      "outerFrame",
      "rect",
      "width"
    ]);

    const invalidPlaybackRate = clone(renderManifestFixture);
    const display = invalidPlaybackRate.visuals[0].display;
    if (display.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    display.playbackRate = 0;
    expectInvalid(invalidPlaybackRate, ["visuals", 0, "display", "playbackRate"]);
  });

  it("validates resolved video trim ranges independently of legacy milliseconds", () => {
    const validFractionalRange = clone(renderManifestFixture);
    const validDisplay = validFractionalRange.visuals[0]?.display;
    if (
      validDisplay?.kind !== "video" ||
      validDisplay.playbackState !== "playing"
    ) {
      throw new Error("fixture must contain a video display");
    }
    validDisplay.endMs = validDisplay.startMs;
    validDisplay.sourceTrimBeforeFrame = 0;
    validDisplay.sourceTrimAfterFrame = 0.4;
    expect(renderManifestSchema.safeParse(validFractionalRange).success).toBe(
      true
    );

    const invalidSourceRange = clone(renderManifestFixture);
    const invalidDisplay = invalidSourceRange.visuals[0]?.display;
    if (
      invalidDisplay?.kind !== "video" ||
      invalidDisplay.playbackState !== "playing"
    ) {
      throw new Error("fixture must contain a video display");
    }
    invalidDisplay.sourceTrimAfterFrame =
      invalidDisplay.sourceTrimBeforeFrame;
    expectInvalid(invalidSourceRange, [
      "visuals",
      0,
      "display",
      "sourceTrimAfterFrame"
    ]);
  });

  it("keeps relative speech intervals inside their line intervals", () => {
    const speechAfterLine = clone(renderManifestFixture);
    speechAfterLine.lines[0].speechFrom = 10;
    expectInvalid(speechAfterLine, [
      "lines",
      0,
      "speechDurationInFrames"
    ]);

    const speechDurationAfterLine = clone(renderManifestFixture);
    speechDurationAfterLine.lines[0].speechDurationInFrames = 46;
    expectInvalid(speechDurationAfterLine, [
      "lines",
      0,
      "speechDurationInFrames"
    ]);

    const outsideRoot = clone(renderManifestFixture);
    outsideRoot.visuals[2].from = 450;
    expectInvalid(outsideRoot, ["visuals", 2, "durationInFrames"]);
  });

  it("rejects overlapping lines while allowing timeline gaps", () => {
    const overlappingLines = clone(renderManifestFixture);
    overlappingLines.lines[1].from = 100;
    expectInvalid(overlappingLines, ["lines", 1, "from"]);
  });

  it("pairs each render visual kind with its display kind", () => {
    const mismatchedVisual = clone(renderManifestFixture);
    const display = mismatchedVisual.visuals[0].display as unknown as {
      kind: string;
    };
    display.kind = "photo";
    expectInvalid(mismatchedVisual, ["visuals", 0, "display", "kind"]);
  });

  it("requires correctly placed resolved video inserts", () => {
    const invalidOpeningDuration = clone(renderManifestFixture);
    invalidOpeningDuration.inserts[0].durationInFrames = 0;
    expectInvalid(invalidOpeningDuration, [
      "inserts",
      0,
      "durationInFrames"
    ]);

    const invalidOpeningPosition = clone(renderManifestFixture);
    invalidOpeningPosition.inserts[0].from = 1;
    expectInvalid(invalidOpeningPosition, ["inserts", 0, "from"]);

    const invalidEndingPosition = clone(renderManifestFixture);
    invalidEndingPosition.inserts[2].from = 419;
    expectInvalid(invalidEndingPosition, ["inserts", 2, "from"]);

    const invalidCutinOverlap = clone(renderManifestFixture);
    invalidCutinOverlap.inserts[1].from = 30;
    expectInvalid(invalidCutinOverlap, [
      "inserts",
      1,
      "from"
    ]);
  });

  it("exports kind-paired visual types through the schema barrel", () => {
    const video = clone(renderManifestFixture).visuals[0];
    expect(getVisualDisplayMetric(video)).toBe(1);
  });

  it("rejects duplicate ids and source asset paths", () => {
    const duplicateLine = clone(renderManifestFixture);
    duplicateLine.lines[1].id = duplicateLine.lines[0].id;
    expectInvalid(duplicateLine, ["lines", 1, "id"]);

    const duplicateVisual = clone(renderManifestFixture);
    duplicateVisual.visuals[1].id = duplicateVisual.visuals[0].id;
    expectInvalid(duplicateVisual, ["visuals", 1, "id"]);

    const duplicateAudio = clone(renderManifestFixture);
    duplicateAudio.audioTracks[1].id = duplicateAudio.audioTracks[0].id;
    expectInvalid(duplicateAudio, ["audioTracks", 1, "id"]);

    const duplicateEffect = clone(renderManifestFixture);
    duplicateEffect.soundEffects[1].id = duplicateEffect.soundEffects[0].id;
    expectInvalid(duplicateEffect, ["soundEffects", 1, "id"]);

    const duplicateInsert = clone(renderManifestFixture);
    duplicateInsert.inserts[1].id = duplicateInsert.inserts[0].id;
    expectInvalid(duplicateInsert, ["inserts", 1, "id"]);

    const duplicatePath = clone(renderManifestFixture);
    duplicatePath.sourceAssetChecksums[1].path =
      duplicatePath.sourceAssetChecksums[0].path;
    expectInvalid(duplicatePath, ["sourceAssetChecksums", 1, "path"]);
  });

  it("rejects unsorted timeline arrays without reordering them", () => {
    const unsortedLines = clone(renderManifestFixture);
    unsortedLines.lines[1].from = 50;
    expectInvalid(unsortedLines, ["lines", 1, "from"]);

    const unsortedVisuals = clone(renderManifestFixture);
    unsortedVisuals.visuals[1].from = 20;
    expectInvalid(unsortedVisuals, ["visuals", 1, "from"]);

    const unsortedInserts = clone(renderManifestFixture);
    unsortedInserts.inserts[1].from = -1;
    expectInvalid(unsortedInserts, ["inserts", 1, "from"]);
  });

  it("requires real section and line references", () => {
    const invalidBackgroundSection = clone(renderManifestFixture);
    invalidBackgroundSection.backgrounds[0].sectionId = "missing-section";
    expectInvalid(invalidBackgroundSection, [
      "backgrounds",
      0,
      "sectionId"
    ]);

    const invalidAudioSection = clone(renderManifestFixture);
    invalidAudioSection.audioTracks[0].sectionId = "missing-section";
    expectInvalid(invalidAudioSection, ["audioTracks", 0, "sectionId"]);

    const invalidEffectLine = clone(renderManifestFixture);
    invalidEffectLine.soundEffects[0].lineId = "missing-line";
    expectInvalid(invalidEffectLine, ["soundEffects", 0, "lineId"]);
  });

  it("rejects duplicate section timelines", () => {
    const duplicateBackground = clone(renderManifestFixture);
    duplicateBackground.backgrounds[1].sectionId =
      duplicateBackground.backgrounds[0].sectionId;
    expectInvalid(duplicateBackground, ["backgrounds", 1, "sectionId"]);

    const duplicateAudio = clone(renderManifestFixture);
    duplicateAudio.audioTracks[1].sectionId =
      duplicateAudio.audioTracks[0].sectionId;
    expectInvalid(duplicateAudio, ["audioTracks", 1, "sectionId"]);
  });

  it("allows an empty edit result and validates resolved insert roles", () => {
    const empty = clone(renderManifestFixture);
    empty.inserts = [];
    expect(renderManifestSchema.safeParse(empty).success).toBe(true);

    const duplicateIntro = clone(renderManifestFixture);
    duplicateIntro.inserts.push({
      ...duplicateIntro.inserts[0]!,
      id: "insert-intro-duplicate"
    });
    expectInvalid(duplicateIntro, ["inserts"]);

    const invalidIntroPosition = clone(renderManifestFixture);
    invalidIntroPosition.inserts[0]!.from = 1;
    expectInvalid(invalidIntroPosition, ["inserts", 0, "from"]);

    const invalidOutroPosition = clone(renderManifestFixture);
    invalidOutroPosition.inserts[2]!.from = 419;
    expectInvalid(invalidOutroPosition, ["inserts", 2, "from"]);
  });

  it.each([
    ["POSIX absolute", "/audio/file.wav"],
    ["Windows drive", "C:/audio/file.wav"],
    ["UNC", "//server/share/file.wav"],
    ["parent segment", "audio/../file.wav"],
    ["backslash", "audio\\file.wav"]
  ])("rejects unsafe manifest paths: %s", (_label, path) => {
    const invalid = clone(renderManifestFixture);
    invalid.lines[0].audioPath = path;

    expectInvalid(invalid, ["lines", 0, "audioPath"]);
  });
});
