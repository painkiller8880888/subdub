import type { ReactNode } from "react";

import { AbsoluteFill, Img } from "remotion";

import type { RenderBackground } from "../schema/index";
import { resolveManifestAssetUrl } from "./asset-url";
import { DESIGN_COLORS } from "./layout";

export function BackgroundVisual({
  background
}: {
  background: RenderBackground["background"] | undefined;
}): ReactNode {
  if (background === undefined || background.kind === "solid") {
    return (
      <AbsoluteFill style={{ backgroundColor: DESIGN_COLORS.background }} />
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: DESIGN_COLORS.background }}>
      <Img
        src={resolveManifestAssetUrl(background.src)}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: background.fit,
          objectPosition: "center center"
        }}
      />
    </AbsoluteFill>
  );
}
