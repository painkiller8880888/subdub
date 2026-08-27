import type { CSSProperties, ReactNode } from "react";

import { AbsoluteFill, OffthreadVideo } from "remotion";

import type { RenderVideoInsertV28 } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { mediaMillisecondsToFrames } from "../media-frame";

export function videoInsertSequenceProps(
  insert: RenderVideoInsertV28,
  fps = 30,
  assetUrlResolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly startFrom: number;
  readonly playbackRate: number;
  readonly volume: number;
} {
  return {
    from: insert.from,
    durationInFrames: insert.durationInFrames,
    src: resolveManifestAssetUrl(insert.src, assetUrlResolver),
    startFrom: mediaMillisecondsToFrames(insert.startMs ?? 0, fps),
    playbackRate: insert.playbackRate,
    volume: insert.volume
  };
}

export function VideoInsert({
  insert,
  fps = 30,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  insert: RenderVideoInsertV28;
  fps?: number;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  const props = videoInsertSequenceProps(insert, fps, assetUrlResolver);
  const text = "text" in insert ? insert.text : null;
  const textStyle: CSSProperties | undefined =
    text === null || text.text.length === 0
      ? undefined
      : {
          position: "absolute",
          left: `${text.resolvedTextLayout.rect.x * 100}%`,
          top: `${text.resolvedTextLayout.rect.y * 100}%`,
          width: `${text.resolvedTextLayout.rect.width * 100}%`,
          height: `${text.resolvedTextLayout.rect.height * 100}%`,
          display: "flex",
          alignItems:
            text.resolvedTextLayout.verticalAlign === "top"
              ? "flex-start"
              : text.resolvedTextLayout.verticalAlign === "bottom"
                ? "flex-end"
                : "center",
          justifyContent:
            text.resolvedTextLayout.textAlign === "left"
              ? "flex-start"
              : text.resolvedTextLayout.textAlign === "right"
                ? "flex-end"
                : "center",
          transform: `rotate(${text.resolvedTextLayout.rotationDeg}deg)`,
          transformOrigin: "center center",
          color: text.resolvedTextLayout.textColor,
          fontSize: text.resolvedTextLayout.fontSize,
          fontWeight: text.resolvedTextLayout.fontWeight,
          textAlign: text.resolvedTextLayout.textAlign,
          whiteSpace: "pre-wrap",
          overflow: "hidden",
          lineHeight: 1.2,
          pointerEvents: "none"
        };
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={props.src}
        startFrom={props.startFrom}
        playbackRate={props.playbackRate}
        volume={props.volume}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover"
        }}
      />
      {textStyle === undefined ? null : (
        <div style={textStyle}>{text?.text}</div>
      )}
    </AbsoluteFill>
  );
}
