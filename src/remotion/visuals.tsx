import type { ReactNode } from "react";

import { Img, OffthreadVideo, useCurrentFrame } from "remotion";

import type { RenderVisual } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { MediaFrame, mediaAssetStyle } from "./layout";

type RenderVideo = Extract<RenderVisual, { kind: "video" }>;
type RenderPhoto = Extract<RenderVisual, { kind: "photo" }>;

function millisecondsToFrames(milliseconds: number, fps: number): number {
  return Math.ceil((milliseconds / 1000) * fps);
}

export function VideoVisual({
  visual,
  fps,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  visual: RenderVideo;
  fps: number;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  useCurrentFrame();
  return (
    <MediaFrame display={visual.display}>
      <OffthreadVideo
        src={resolveManifestAssetUrl(visual.src, assetUrlResolver)}
        trimBefore={millisecondsToFrames(visual.display.startMs, fps)}
        trimAfter={millisecondsToFrames(visual.display.endMs, fps)}
        playbackRate={visual.display.playbackRate}
        muted={visual.display.muted}
        style={{
          ...mediaAssetStyle,
          objectFit: visual.display.fit
        }}
      />
    </MediaFrame>
  );
}

export function PhotoVisual({
  visual,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  visual: RenderPhoto;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  return (
    <MediaFrame display={visual.display}>
      <Img
        src={resolveManifestAssetUrl(visual.src, assetUrlResolver)}
        style={{
          ...mediaAssetStyle,
          objectFit: visual.display.fit
        }}
      />
    </MediaFrame>
  );
}
