import type { ReactNode } from "react";

import { Freeze, Img, OffthreadVideo } from "remotion";

import type { RenderVisual } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { MediaFrame, mediaAssetStyle } from "./layout";

type RenderVideo = Extract<RenderVisual, { kind: "video" }>;
type RenderPhoto = Extract<RenderVisual, { kind: "photo" }>;

export function VideoVisual({
  visual,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  visual: RenderVideo;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  const playback = visual.display;
  const video =
    playback.playbackState === "playing" ? (
      <OffthreadVideo
        src={resolveManifestAssetUrl(visual.src, assetUrlResolver)}
        trimBefore={playback.sourceTrimBeforeFrame}
        trimAfter={playback.sourceTrimAfterFrame}
        playbackRate={playback.playbackRate}
        volume={playback.volume}
        style={{
          ...mediaAssetStyle,
          objectFit: playback.fit
        }}
      />
    ) : (
      <Freeze frame={0}>
        <OffthreadVideo
          src={resolveManifestAssetUrl(visual.src, assetUrlResolver)}
          trimBefore={playback.sourceFrame}
          trimAfter={playback.sourceFrame + 1}
          playbackRate={1}
          volume={0}
          style={{
            ...mediaAssetStyle,
            objectFit: playback.fit
          }}
        />
      </Freeze>
    );
  return <MediaFrame display={visual.display}>{video}</MediaFrame>;
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
