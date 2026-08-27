import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type { RenderVideoInsertV28 } from "../../src/schema/index.js";
import { VideoInsert } from "../../src/remotion/video-insert.js";

function insert(
  role: RenderVideoInsertV28["role"],
  text: string
): RenderVideoInsertV28 {
  return {
    id: `insert-${role}`,
    role,
    from: 0,
    durationInFrames: 30,
    src: `media/${role}.mp4`,
    startMs: 5000,
    playbackRate: 0.5,
    volume: 0.5,
    text:
      text.length === 0
        ? null
        : {
            templateId: "insert-text-template",
            templateRevision: 2,
            templateHash: "a".repeat(64),
            text,
            resolvedTextLayout: {
              rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.3 },
              rotationDeg: -2,
              fontSize: 48,
              fontWeight: 700,
              textColor: "#12abef",
              textAlign: "center",
              verticalAlign: "bottom"
            }
          }
  };
}

function childElements(value: ReactNode): ReactElement[] {
  return Children.toArray(value).filter(
    (child): child is ReactElement =>
      typeof child === "object" && child !== null
  );
}

function containerChildren(value: ReactNode): ReactNode {
  return (value as ReactElement<{ children?: ReactNode }>).props.children;
}

describe("Remotion insert text overlay", () => {
  it("renders the same manifest snapshot overlay path for intro, cutin, and outro", () => {
    for (const role of ["intro", "cutin", "outro"] as const) {
      const result = VideoInsert({
        insert: insert(role, "一行目\n二行目"),
        fps: 30
      });
      const children = childElements(containerChildren(result));
      expect(children).toHaveLength(2);
      const overlay = children[1]! as ReactElement<{
        children: string;
        style: Record<string, unknown>;
      }>;
      expect(overlay.type).toBe("div");
      expect(overlay.props.children).toBe("一行目\n二行目");
      expect(overlay.props.style).toMatchObject({
        left: "10%",
        top: "20%",
        width: "80%",
        height: "30%",
        transform: "rotate(-2deg)",
        color: "#12abef",
        textAlign: "center",
        whiteSpace: "pre-wrap"
      });
    }
  });

  it("passes the manifest-resolved source offset, rate, and volume to video", () => {
    const result = VideoInsert({ insert: insert("intro", ""), fps: 30 });
    const video = childElements(containerChildren(result))[0] as ReactElement<{
      startFrom: number;
      playbackRate: number;
      volume: number;
    }>;

    expect(video.props).toMatchObject({
      startFrom: 150,
      playbackRate: 0.5,
      volume: 0.5
    });
  });

  it("does not add a text DOM node when the snapshot is null or empty", () => {
    const result = VideoInsert({ insert: insert("intro", ""), fps: 30 });
    const children = childElements(containerChildren(result));

    expect(children).toHaveLength(1);
  });
});
