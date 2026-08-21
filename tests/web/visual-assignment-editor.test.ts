import { describe, expect, it } from "vitest";

import {
  addVisualAnnotation,
  addVisualPlaybackCue,
  clampUnitInterval,
  defaultDisplayForAsset,
  isSelectableGenericVisualAsset,
  nextVisualAssignmentId,
  playbackCuesOutsideRange,
  removePlaybackCuesOutsideRange,
  replacementDisplayForAsset,
  removeVisualAnnotation,
  updateVisualAnnotation,
  updateVisualAssignmentVideoVolume
} from "../../src/web/visual-assignment-editor.js";
import type {
  AssetListItem,
  VisualAssignment
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function listAsset(overrides: Partial<AssetListItem> = {}): AssetListItem {
  return {
    assetId: "asset-list-item",
    version: 1,
    kind: "photo",
    title: "表示素材",
    description: "",
    confidentiality: "internal",
    department: null,
    system: null,
    mimeType: "image/png",
    checksum: "a".repeat(64),
    sizeBytes: 100,
    width: 1920,
    height: 1080,
    durationMs: null,
    pageCount: null,
    thumbnailPaths: [],
    tags: [],
    tagIds: [],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides
  };
}

describe("visual assignment editor helpers", () => {
  it("creates explicit defaults and refuses missing media metadata", () => {
    const video = defaultDisplayForAsset({
      assetId: "video-1",
      kind: "video",
      durationMs: 1200,
      pageCount: null
    });
    expect(video.display).toMatchObject({
      kind: "video",
      fit: "contain",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      position: { x: 0.5, y: 0.5 },
      prioritizeVisual: false,
      startMs: 0,
      endMs: 1200,
      playbackRate: 1,
      volume: 0,
      annotations: []
    });

    expect(
      defaultDisplayForAsset({
        assetId: "video-2",
        kind: "video",
        durationMs: null,
        pageCount: null
      })
    ).toEqual({
      display: undefined,
      reason: "動画の尺が未取得のため割り当てできません。"
    });
    expect(
      defaultDisplayForAsset({
        assetId: "document-1",
        kind: "document_scan",
        durationMs: null,
        pageCount: 3
      }).display
    ).toMatchObject({ kind: "document_scan", page: 1 });
  });

  it("supports static annotation add, edit, and remove", () => {
    const assignment = clone(
      videoProjectFixture.visuals.assignments[1]
    ) as VisualAssignment;
    const withAnnotation = addVisualAnnotation(assignment);
    const annotation = withAnnotation.display.annotations[0];
    expect(annotation).toMatchObject({
      kind: "label",
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.08,
      colorToken: "accent"
    });
    if (annotation === undefined) {
      throw new Error("annotation was not added");
    }

    const updated = updateVisualAnnotation(withAnnotation, annotation.id, {
      kind: "box",
      text: "確認",
      x: 0.2,
      colorToken: "warning"
    });
    expect(updated.display.annotations[0]).toMatchObject({
      kind: "box",
      text: "確認",
      x: 0.2,
      colorToken: "warning"
    });
    expect(
      removeVisualAnnotation(updated, annotation.id).display.annotations
    ).toEqual([]);
  });

  it("uses project-safe IDs for annotations added to different assignments", () => {
    const assignments = clone(
      videoProjectFixture.visuals.assignments
    ) as VisualAssignment[];
    const first = addVisualAnnotation(assignments[0]);
    const second = addVisualAnnotation(assignments[1]);

    expect(first.display.annotations[0]?.id).not.toBe(
      second.display.annotations[0]?.id
    );
  });

  it("generates a non-conflicting assignment ID", () => {
    const assignments = clone(videoProjectFixture.visuals.assignments);
    assignments[0].id = "visual-assignment-1";
    expect(nextVisualAssignmentId(assignments)).toBe("visual-assignment-4");
  });

  it("updates generic video volume across the full unit interval", () => {
    const assignment = clone(
      videoProjectFixture.visuals.assignments[0]
    ) as VisualAssignment;

    expect(
      updateVisualAssignmentVideoVolume(assignment, 0).display
    ).toMatchObject({ kind: "video", volume: 0 });
    expect(
      updateVisualAssignmentVideoVolume(assignment, 0.25).display
    ).toMatchObject({ kind: "video", volume: 0.25 });
    expect(
      updateVisualAssignmentVideoVolume(assignment, 1).display
    ).toMatchObject({ kind: "video", volume: 1 });
    expect(
      updateVisualAssignmentVideoVolume(assignment, 1.5).display
    ).toMatchObject({ kind: "video", volume: 1 });
    expect(
      updateVisualAssignmentVideoVolume(assignment, -0.5).display
    ).toMatchObject({ kind: "video", volume: 0 });
    expect(
      updateVisualAssignmentVideoVolume(assignment, Number.NaN).display
    ).toMatchObject({ kind: "video", volume: 0 });
    expect(
      updateVisualAssignmentVideoVolume(
        clone(videoProjectFixture.visuals.assignments[1]),
        0.25
      )
    ).toEqual(videoProjectFixture.visuals.assignments[1]);
    expect(clampUnitInterval(0.25)).toBe(0.25);
  });

  it("limits the script picker to usable active generic visual assets", () => {
    expect(
      isSelectableGenericVisualAsset(
        listAsset({ kind: "video", mimeType: "video/mp4", durationMs: 1200 })
      )
    ).toBe(true);
    expect(
      isSelectableGenericVisualAsset(
        listAsset({
          kind: "document_scan",
          mimeType: "application/pdf",
          pageCount: 2
        })
      )
    ).toBe(true);
    expect(
      isSelectableGenericVisualAsset(
        listAsset({ kind: "sound_effect", mimeType: "audio/wav" })
      )
    ).toBe(false);
    expect(
      isSelectableGenericVisualAsset(
        listAsset({ kind: "video", mimeType: "video/mp4", durationMs: null })
      )
    ).toBe(false);
    expect(
      isSelectableGenericVisualAsset(listAsset({ status: "inactive" }))
    ).toBe(false);
  });

  it("adds one before-boundary cue and preserves it for video replacement", () => {
    const assignment = clone(
      videoProjectFixture.visuals.assignments[0]
    ) as VisualAssignment;
    if (assignment.display.kind !== "video") {
      throw new Error("video fixture assignment was not a video");
    }
    const currentVideoDisplay = assignment.display;
    const withCue = addVisualPlaybackCue(
      { ...assignment, display: { ...assignment.display, playbackCues: [] } },
      "intro-learner-1",
      "pause"
    );
    if (withCue.display.kind !== "video") {
      throw new Error("video cue assignment was not a video");
    }
    const trimmed = {
      ...withCue,
      display: {
        ...withCue.display,
        startMs: 500,
        endMs: 2_000
      }
    };
    const submittedTwice = addVisualPlaybackCue(
      withCue,
      "intro-learner-1",
      "pause"
    );

    expect(withCue.display).toMatchObject({
      kind: "video",
      playbackCues: [
        { lineId: "intro-learner-1", edge: "before", action: "pause" }
      ]
    });
    expect(submittedTwice.display).toEqual(withCue.display);

    const replacement = replacementDisplayForAsset(trimmed, {
      assetId: "asset-video-replacement",
      kind: "video",
      durationMs: 5000,
      pageCount: null
    });
    if (
      replacement.display === undefined ||
      replacement.display.kind !== "video"
    ) {
      throw new Error("video replacement display was not created");
    }
    expect(replacement.display.startMs).toBe(500);
    expect(replacement.display.endMs).toBe(2_000);
    expect(replacement.display.playbackRate).toBe(
      currentVideoDisplay.playbackRate
    );
    expect(replacement.display.volume).toBe(currentVideoDisplay.volume);
    expect(replacement.display.playbackCues).toEqual(
      withCue.display.playbackCues
    );
  });

  it("resets kind-specific state when a video is replaced with a static visual", () => {
    const assignment = clone(
      videoProjectFixture.visuals.assignments[0]
    ) as VisualAssignment;
    if (assignment.display.kind !== "video") {
      throw new Error("video fixture assignment was not a video");
    }
    assignment.display.playbackCues = [
      { lineId: "intro-learner-1", edge: "before", action: "pause" }
    ];

    const replacement = replacementDisplayForAsset(assignment, {
      assetId: "asset-photo-replacement",
      kind: "photo",
      durationMs: null,
      pageCount: null
    });
    expect(replacement.display).toMatchObject({ kind: "photo" });
    expect(replacement.display).not.toHaveProperty("playbackCues");
  });

  it("rejects same-kind replacements that cannot preserve the current range or page", () => {
    const videoAssignment = clone(
      videoProjectFixture.visuals.assignments[0]
    ) as VisualAssignment;
    if (videoAssignment.display.kind !== "video") {
      throw new Error("video fixture assignment was not a video");
    }
    videoAssignment.display.startMs = 1_000;
    videoAssignment.display.endMs = 4_000;
    const tooShortVideo = replacementDisplayForAsset(videoAssignment, {
      assetId: "asset-short-video",
      kind: "video",
      durationMs: 3_000,
      pageCount: null
    });
    expect(tooShortVideo.display).toBeUndefined();
    expect(tooShortVideo.reason).toContain("既存の動画トリム");

    const documentAssignment = clone(
      videoProjectFixture.visuals.assignments[2]
    ) as VisualAssignment;
    if (documentAssignment.display.kind !== "document_scan") {
      throw new Error("document fixture assignment was not a document");
    }
    documentAssignment.display.page = 2;
    const replacementDocument = replacementDisplayForAsset(documentAssignment, {
      assetId: "asset-document-replacement",
      kind: "document_scan",
      durationMs: null,
      pageCount: 3
    });
    expect(replacementDocument.display).toMatchObject({
      kind: "document_scan",
      page: 2
    });

    const tooFewPages = replacementDisplayForAsset(documentAssignment, {
      assetId: "asset-short-document",
      kind: "document_scan",
      durationMs: null,
      pageCount: 1
    });
    expect(tooFewPages.display).toBeUndefined();
    expect(tooFewPages.reason).toContain("既存の2ページ目");
  });

  it("reports and removes cues outside an explicitly shortened range", () => {
    const assignment = clone(
      videoProjectFixture.visuals.assignments[0]
    ) as VisualAssignment;
    if (assignment.display.kind !== "video") {
      throw new Error("video fixture assignment was not a video");
    }
    assignment.endLineId = "intro-learner-1";
    assignment.display.playbackCues = [
      { lineId: "intro-learner-1", edge: "before", action: "pause" },
      { lineId: "main-mentor-1", edge: "before", action: "resume" }
    ];
    const section = videoProjectFixture.script.sections[0];
    if (section === undefined) {
      throw new Error("script section was not found");
    }

    expect(
      playbackCuesOutsideRange(assignment, section, "intro-mentor-1")
    ).toEqual([
      { lineId: "intro-learner-1", edge: "before", action: "pause" },
      { lineId: "main-mentor-1", edge: "before", action: "resume" }
    ]);
    expect(
      removePlaybackCuesOutsideRange(assignment, section, "intro-mentor-1")
    ).toMatchObject({
      endLineId: "intro-mentor-1",
      display: { kind: "video", playbackCues: [] }
    });
  });
});
