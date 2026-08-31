import { describe, expect, it } from "vitest";

import {
  lineOverlayPlanSchema,
  videoProjectSchema
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const baseOverlay = {
  id: "overlay-highlight",
  lineId: "intro-mentor-1",
  transform: {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.2,
    rotationDeg: 12
  },
  colorToken: "accent" as const,
  animation: "none" as const
};

describe("line overlay schema", () => {
  it("accepts each supported primitive and keeps label text explicit", () => {
    const result = lineOverlayPlanSchema.safeParse({
      lineOverlays: [
        { ...baseOverlay, kind: "circle", text: null },
        { ...baseOverlay, id: "overlay-box", kind: "box", text: null },
        { ...baseOverlay, id: "overlay-arrow", kind: "arrow", text: null },
        {
          ...baseOverlay,
          id: "overlay-label",
          kind: "label",
          text: "申請ボタン"
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects blank labels and overlays that cannot intersect the canvas", () => {
    expect(
      lineOverlayPlanSchema.safeParse({
        lineOverlays: [{ ...baseOverlay, kind: "label", text: "  " }]
      }).success
    ).toBe(false);
    expect(
      lineOverlayPlanSchema.safeParse({
        lineOverlays: [
          {
            ...baseOverlay,
            transform: { ...baseOverlay.transform, x: 2 }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("validates line references and duplicate IDs at the project boundary", () => {
    const project = structuredClone(videoProjectFixture) as unknown as {
      overlays: { lineOverlays: unknown[] };
    };
    project.overlays.lineOverlays = [
      { ...baseOverlay, kind: "box", text: null },
      { ...baseOverlay, kind: "arrow", text: null }
    ];
    expect(videoProjectSchema.safeParse(project).success).toBe(false);

    project.overlays.lineOverlays = [
      { ...baseOverlay, lineId: "deleted-line", kind: "box", text: null }
    ];
    expect(videoProjectSchema.safeParse(project).success).toBe(false);
  });
});
