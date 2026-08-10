import type { FC } from "react";

import { Composition, registerRoot } from "remotion";

import type { RenderManifest } from "../schema/index";
import { RenderManifestComposition } from "./composition";
import { defaultRenderManifest } from "./default-manifest";

const RemotionRoot: FC = () => (
  <Composition
    id="BasicRemotionComposition"
    component={RenderManifestComposition}
    defaultProps={defaultRenderManifest}
    calculateMetadata={({ props }) => {
      const manifest = props as RenderManifest;
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
