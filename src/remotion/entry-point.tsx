import type { FC } from "react";

import { Composition, registerRoot } from "remotion";

import {
  RenderManifestComposition,
  renderManifestFromInput,
  type RenderManifestCompositionInput
} from "./composition";
import { defaultRenderManifest } from "./default-manifest";
import { StandardThumbnailComposition } from "./thumbnail-composition";
import {
  defaultStandardThumbnailCompositionInput,
  STANDARD_THUMBNAIL_COMPOSITION_ID,
  STANDARD_THUMBNAIL_DURATION_IN_FRAMES,
  STANDARD_THUMBNAIL_FPS,
  STANDARD_THUMBNAIL_HEIGHT,
  STANDARD_THUMBNAIL_WIDTH
} from "./thumbnail-spec";

const RemotionRoot: FC = () => (
  <>
    <Composition
      id="BasicRemotionComposition"
      component={RenderManifestComposition}
      defaultProps={defaultRenderManifest}
      calculateMetadata={({ props }) => {
        const manifest = renderManifestFromInput(
          props as RenderManifestCompositionInput
        );
        return {
          durationInFrames: manifest.durationInFrames,
          fps: manifest.fps,
          width: manifest.width,
          height: manifest.height
        };
      }}
    />
    <Composition
      id={STANDARD_THUMBNAIL_COMPOSITION_ID}
      component={StandardThumbnailComposition}
      defaultProps={defaultStandardThumbnailCompositionInput}
      width={STANDARD_THUMBNAIL_WIDTH}
      height={STANDARD_THUMBNAIL_HEIGHT}
      fps={STANDARD_THUMBNAIL_FPS}
      durationInFrames={STANDARD_THUMBNAIL_DURATION_IN_FRAMES}
      calculateMetadata={() => ({
        durationInFrames: STANDARD_THUMBNAIL_DURATION_IN_FRAMES,
        fps: STANDARD_THUMBNAIL_FPS,
        width: STANDARD_THUMBNAIL_WIDTH,
        height: STANDARD_THUMBNAIL_HEIGHT
      })}
    />
  </>
);

registerRoot(RemotionRoot);
