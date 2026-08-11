import type { FC } from "react";

import { Composition, registerRoot } from "remotion";

import {
  RenderManifestComposition,
  renderManifestFromInput,
  type RenderManifestCompositionInput
} from "./composition";
import { defaultRenderManifest } from "./default-manifest";

const RemotionRoot: FC = () => (
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
);

registerRoot(RemotionRoot);
