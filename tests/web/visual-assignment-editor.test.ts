import { describe, expect, it } from "vitest";

import {
  addVisualAnnotation,
  defaultDisplayForAsset,
  nextVisualAssignmentId,
  removeVisualAnnotation,
  updateVisualAnnotation
} from "../../src/web/visual-assignment-editor.js";
import type { VisualAssignment } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return structuredClone(value);
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
      muted: true,
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
});
