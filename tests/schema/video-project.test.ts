import { describe, expect, it } from "vitest";

import {
  DEFAULT_SOUND_EFFECT_VOLUME,
  createSoundEffect,
  videoProjectSchema,
  type VideoProject
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone(value: typeof videoProjectFixture): VideoProject;
function clone<T>(value: T): T;
function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(
  value: unknown,
  expectedPath?: ReadonlyArray<string | number>
): void {
  const result = videoProjectSchema.safeParse(value);
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

describe("videoProjectSchema", () => {
  it("accepts the complete project fixture", () => {
    const result = videoProjectSchema.safeParse(clone(videoProjectFixture));

    expect(result.success).toBe(true);
  });

  it("defaults newly created sound effects to 0.2 without rewriting explicit volume", () => {
    const draft = {
      id: "created-effect",
      soundEffectAssetId: "created-asset",
      assetChecksum: "a".repeat(64),
      projectMediaPath: "media/created-effect.wav",
      category: "confirm" as const,
      lineId: "main-learner-1",
      offsetMs: 0
    };

    expect(DEFAULT_SOUND_EFFECT_VOLUME).toBe(0.2);
    expect(createSoundEffect(draft).volume).toBe(0.2);
    expect(createSoundEffect({ ...draft, volume: 0 }).volume).toBe(0);
    expect(createSoundEffect({ ...draft, volume: 0.35 }).volume).toBe(0.35);
  });

  it("rejects unknown keys at the root and in deep objects", () => {
    const rootUnknown = clone(videoProjectFixture);
    Object.assign(rootUnknown, { unexpected: true });
    expectInvalid(rootUnknown);

    const deepUnknown = clone(videoProjectFixture);
    Object.assign(deepUnknown.characters[0].visualAssets.neutral, {
      unexpected: true
    });
    expectInvalid(deepUnknown);
  });

  it("rejects unknown task model override keys", () => {
    const invalid = clone(videoProjectFixture);
    Object.assign(invalid.aiSettings.taskModelOverrides, {
      unknown_task: "model"
    });

    expectInvalid(invalid, ["aiSettings", "taskModelOverrides"]);
  });

  it("rejects invalid integer and finite-number values", () => {
    const negativeDuration = clone(videoProjectFixture);
    negativeDuration.brief.targetDurationSec = -1;
    expectInvalid(negativeDuration, ["brief", "targetDurationSec"]);

    const negativePause = clone(videoProjectFixture);
    negativePause.script.sections[0].lines[0].pauseBeforeMs = -1;
    expectInvalid(negativePause, [
      "script",
      "sections",
      0,
      "lines",
      0,
      "pauseBeforeMs"
    ]);

    const negativeOffset = clone(videoProjectFixture);
    negativeOffset.audio.soundEffects[0].offsetMs = -1;
    expectInvalid(negativeOffset, ["audio", "soundEffects", 0, "offsetMs"]);

    const nonFinite = clone(videoProjectFixture);
    nonFinite.characters[0].voice.speedScale = Number.NaN;
    expectInvalid(nonFinite, [
      "characters",
      0,
      "voice",
      "speedScale"
    ]);
  });

  it("rejects zero or invalid positive values and out-of-range units", () => {
    const zeroPlaybackRate = clone(videoProjectFixture);
    const videoDisplay = zeroPlaybackRate.visuals.assignments[0].display;
    if (videoDisplay.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    videoDisplay.playbackRate = 0;
    expectInvalid(zeroPlaybackRate, [
      "visuals",
      "assignments",
      0,
      "display",
      "playbackRate"
    ]);

    const invalidVideoRange = clone(videoProjectFixture);
    const invalidDisplay = invalidVideoRange.visuals.assignments[0].display;
    if (invalidDisplay.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    invalidDisplay.endMs = invalidDisplay.startMs;
    expectInvalid(invalidVideoRange, [
      "visuals",
      "assignments",
      0,
      "display",
      "endMs"
    ]);

    const invalidVolume = clone(videoProjectFixture);
    invalidVolume.audio.sectionBgms[0].volume = 1.1;
    expectInvalid(invalidVolume, ["audio", "sectionBgms", 0, "volume"]);

    const invalidCrop = clone(videoProjectFixture);
    invalidCrop.visuals.assignments[0].display.crop.width = 1.1;
    expectInvalid(invalidCrop, [
      "visuals",
      "assignments",
      0,
      "display",
      "crop",
      "width"
    ]);

    const cropOutside = clone(videoProjectFixture);
    cropOutside.visuals.assignments[0].display.crop.x = 0.8;
    expectInvalid(cropOutside, [
      "visuals",
      "assignments",
      0,
      "display",
      "crop",
      "width"
    ]);

    const invalidPosition = clone(videoProjectFixture);
    invalidPosition.visuals.assignments[0].display.position.x = -0.1;
    expectInvalid(invalidPosition, [
      "visuals",
      "assignments",
      0,
      "display",
      "position",
      "x"
    ]);

    const invalidPage = clone(videoProjectFixture);
    const documentDisplay = invalidPage.visuals.assignments[2].display;
    if (documentDisplay.kind !== "document_scan") {
      throw new Error("fixture must contain a document display");
    }
    documentDisplay.page = 0;
    expectInvalid(invalidPage, [
      "visuals",
      "assignments",
      2,
      "display",
      "page"
    ]);
  });

  it("limits static annotations to normalized display rectangles", () => {
    const outsideX = clone(videoProjectFixture);
    outsideX.visuals.assignments[0].display.annotations[0].x = 0.8;
    expectInvalid(outsideX, [
      "visuals",
      "assignments",
      0,
      "display",
      "annotations",
      0,
      "width"
    ]);

    const outsideY = clone(videoProjectFixture);
    outsideY.visuals.assignments[0].display.annotations[0].y = 0.95;
    expectInvalid(outsideY, [
      "visuals",
      "assignments",
      0,
      "display",
      "annotations",
      0,
      "height"
    ]);

    const invalidCoordinate = clone(videoProjectFixture);
    invalidCoordinate.visuals.assignments[0].display.annotations[0].x = -0.1;
    expectInvalid(invalidCoordinate, [
      "visuals",
      "assignments",
      0,
      "display",
      "annotations",
      0,
      "x"
    ]);

    const nullableSize = clone(videoProjectFixture);
    nullableSize.visuals.assignments[0].display.annotations[0].width = null;
    nullableSize.visuals.assignments[0].display.annotations[0].height = null;
    expect(videoProjectSchema.safeParse(nullableSize).success).toBe(true);
  });

  it("rejects non-literal placeholder durations and empty thumbnail fields", () => {
    const invalidOpening = clone(videoProjectFixture);
    Object.assign(invalidOpening.inserts.opening, { durationMs: 1000 });
    expectInvalid(invalidOpening, [
      "inserts",
      "opening",
      "durationMs"
    ]);

    const invalidOpeningSlot = clone(videoProjectFixture);
    Object.assign(invalidOpeningSlot.inserts.opening, { slot: "ending" });
    expectInvalid(invalidOpeningSlot, [
      "inserts",
      "opening",
      "slot"
    ]);

    const invalidEyeCatch = clone(videoProjectFixture);
    Object.assign(invalidEyeCatch.inserts.eyeCatches[0], { durationMs: 1000 });
    expectInvalid(invalidEyeCatch, [
      "inserts",
      "eyeCatches",
      0,
      "durationMs"
    ]);

    const emptyTitle = clone(videoProjectFixture);
    emptyTitle.thumbnail.title = "";
    expectInvalid(emptyTitle, ["thumbnail", "title"]);

    const emptyDepartment = clone(videoProjectFixture);
    emptyDepartment.thumbnail.departmentOrSystem = "";
    expectInvalid(emptyDepartment, ["thumbnail", "departmentOrSystem"]);
  });

  it("rejects duplicate ids in the main collections", () => {
    const duplicateCharacter = clone(videoProjectFixture);
    duplicateCharacter.characters[1].id = duplicateCharacter.characters[0].id;
    expectInvalid(duplicateCharacter, ["characters", 1, "id"]);

    const duplicateOutlineSection = clone(videoProjectFixture);
    duplicateOutlineSection.outline.sections[1].id =
      duplicateOutlineSection.outline.sections[0].id;
    expectInvalid(duplicateOutlineSection, ["outline", "sections", 1, "id"]);

    const duplicateOpenQuestion = clone(videoProjectFixture);
    duplicateOpenQuestion.outline.sections[0].openQuestions.push(
      clone(duplicateOpenQuestion.outline.openQuestions[0])
    );
    expectInvalid(duplicateOpenQuestion, [
      "outline",
      "sections",
      0,
      "openQuestions",
      0,
      "id"
    ]);

    const duplicateScriptSection = clone(videoProjectFixture);
    duplicateScriptSection.script.sections[1].id =
      duplicateScriptSection.script.sections[0].id;
    expectInvalid(duplicateScriptSection, ["script", "sections", 1, "id"]);

    const duplicateLine = clone(videoProjectFixture);
    duplicateLine.script.sections[1].lines[0].id =
      duplicateLine.script.sections[0].lines[0].id;
    expectInvalid(duplicateLine, [
      "script",
      "sections",
      1,
      "lines",
      0,
      "id"
    ]);

    const duplicateVisual = clone(videoProjectFixture);
    duplicateVisual.visuals.assignments[1].id =
      duplicateVisual.visuals.assignments[0].id;
    expectInvalid(duplicateVisual, ["visuals", "assignments", 1, "id"]);

    const duplicateAnnotation = clone(videoProjectFixture);
    duplicateAnnotation.visuals.assignments[1].display.annotations.push(
      clone(duplicateAnnotation.visuals.assignments[0].display.annotations[0])
    );
    expectInvalid(duplicateAnnotation, [
      "visuals",
      "assignments",
      1,
      "display",
      "annotations",
      0,
      "id"
    ]);

    const duplicateBgm = clone(videoProjectFixture);
    duplicateBgm.audio.sectionBgms[1].id =
      duplicateBgm.audio.sectionBgms[0].id;
    expectInvalid(duplicateBgm, ["audio", "sectionBgms", 1, "id"]);

    const duplicateEffect = clone(videoProjectFixture);
    duplicateEffect.audio.soundEffects[1].id =
      duplicateEffect.audio.soundEffects[0].id;
    expectInvalid(duplicateEffect, ["audio", "soundEffects", 1, "id"]);

    const duplicateInsert = clone(videoProjectFixture);
    duplicateInsert.inserts.ending.id = duplicateInsert.inserts.opening.id;
    expectInvalid(duplicateInsert, ["inserts", "ending", "id"]);
  });

  it("rejects inconsistent character mappings", () => {
    const invalidRole = clone(videoProjectFixture);
    invalidRole.characters[0].role = "learner";
    expectInvalid(invalidRole, ["characters", 0, "role"]);

    const invalidSpeaker = clone(videoProjectFixture);
    invalidSpeaker.characters[1].voicevox.speakerName = "四国めたん";
    expectInvalid(invalidSpeaker, [
      "characters",
      1,
      "voicevox",
      "speakerName"
    ]);

    const invalidTheme = clone(videoProjectFixture);
    invalidTheme.characters[1].themeColorToken = "character.metan";
    expectInvalid(invalidTheme, ["characters", 1, "themeColorToken"]);
  });

  it("rejects broken references", () => {
    const invalidSourceReference = clone(videoProjectFixture);
    invalidSourceReference.outline.sections[0].sourceRefs[0].sourceId =
      "other-source";
    expectInvalid(invalidSourceReference, [
      "outline",
      "sections",
      0,
      "sourceRefs",
      0,
      "sourceId"
    ]);

    const invalidOutlineReference = clone(videoProjectFixture);
    invalidOutlineReference.script.sections[0].outlineSectionId =
      "missing-outline";
    expectInvalid(invalidOutlineReference, [
      "script",
      "sections",
      0,
      "outlineSectionId"
    ]);

    const invalidSpeakerReference = clone(videoProjectFixture);
    invalidSpeakerReference.script.sections[0].lines[0].speakerId =
      "missing-character";
    expectInvalid(invalidSpeakerReference, [
      "script",
      "sections",
      0,
      "lines",
      0,
      "speakerId"
    ]);

    const invalidBgmReference = clone(videoProjectFixture);
    invalidBgmReference.audio.sectionBgms[0].sectionId = "missing-section";
    expectInvalid(invalidBgmReference, [
      "audio",
      "sectionBgms",
      0,
      "sectionId"
    ]);

    const invalidEffectReference = clone(videoProjectFixture);
    invalidEffectReference.audio.soundEffects[0].lineId = "missing-line";
    expectInvalid(invalidEffectReference, [
      "audio",
      "soundEffects",
      0,
      "lineId"
    ]);

    const invalidEyeCatchReference = clone(videoProjectFixture);
    invalidEyeCatchReference.inserts.eyeCatches[0].beforeSectionId =
      "missing-section";
    expectInvalid(invalidEyeCatchReference, [
      "inserts",
      "eyeCatches",
      0,
      "beforeSectionId"
    ]);

    const invalidFirstEyeCatch = clone(videoProjectFixture);
    invalidFirstEyeCatch.inserts.eyeCatches[0].beforeSectionId =
      "section-intro";
    expectInvalid(invalidFirstEyeCatch, [
      "inserts",
      "eyeCatches",
      0,
      "beforeSectionId"
    ]);

    const invalidThumbnailCharacter = clone(videoProjectFixture);
    invalidThumbnailCharacter.thumbnail.characterId = "missing-character";
    expectInvalid(invalidThumbnailCharacter, ["thumbnail", "characterId"]);
  });

  it("rejects visual ranges that cross or reverse script sections", () => {
    const missingStart = clone(videoProjectFixture);
    missingStart.visuals.assignments[0].startLineId = "missing-line";
    expectInvalid(missingStart, [
      "visuals",
      "assignments",
      0,
      "startLineId"
    ]);

    const crossingRange = clone(videoProjectFixture);
    crossingRange.visuals.assignments[0].endLineId = "main-mentor-1";
    expectInvalid(crossingRange, [
      "visuals",
      "assignments",
      0,
      "endLineId"
    ]);

    const reversedRange = clone(videoProjectFixture);
    reversedRange.visuals.assignments[1].startLineId = "main-learner-1";
    reversedRange.visuals.assignments[1].endLineId = "main-mentor-1";
    expectInvalid(reversedRange, [
      "visuals",
      "assignments",
      1,
      "startLineId"
    ]);

    const duplicateSectionBgm = clone(videoProjectFixture);
    duplicateSectionBgm.audio.sectionBgms[1].sectionId =
      duplicateSectionBgm.audio.sectionBgms[0].sectionId;
    expectInvalid(duplicateSectionBgm, [
      "audio",
      "sectionBgms",
      1,
      "sectionId"
    ]);
  });

  it.each([
    ["POSIX absolute", "/media/file.png"],
    ["Windows drive", "C:/media/file.png"],
    ["UNC", "//server/share/file.png"],
    ["parent segment", "media/../file.png"],
    ["backslash", "media\\file.png"]
  ])("rejects unsafe project paths: %s", (_label, path) => {
    const invalid = clone(videoProjectFixture);
    invalid.visuals.assignments[0].projectMediaPath = path;

    expectInvalid(invalid, [
      "visuals",
      "assignments",
      0,
      "projectMediaPath"
    ]);
  });
});
