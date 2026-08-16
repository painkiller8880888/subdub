import type { ReactNode } from "react";

import { OffthreadVideo } from "remotion";

import type { RenderVideoInsert } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";

export function videoInsertSequenceProps(
  insert: RenderVideoInsert,
  assetUrlResolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly volume: number;
} {
  return {
    from: insert.from,
    durationInFrames: insert.durationInFrames,
    src: resolveManifestAssetUrl(insert.src, assetUrlResolver),
    volume: insert.volume
  };
}

export function VideoInsert({
  insert,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  insert: RenderVideoInsert;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  const props = videoInsertSequenceProps(insert, assetUrlResolver);
  return (
    <OffthreadVideo
      src={props.src}
      volume={props.volume}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover"
      }}
    />
  );
}
