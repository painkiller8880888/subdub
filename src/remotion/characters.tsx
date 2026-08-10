import type { ReactNode } from "react";

import { Img } from "remotion";

import type { RenderManifest } from "../schema/index";
import { resolveManifestAssetUrl } from "./asset-url";
import { DESIGN_COLORS } from "./layout";
import { selectCharacterVariantForFrame } from "./selection";

export function CharacterLayer({
  manifest,
  frame,
  prioritizeVisual
}: {
  manifest: RenderManifest;
  frame: number;
  prioritizeVisual: boolean;
}): ReactNode {
  const characters = manifest.characters.slice(0, 2);
  return characters.map((character, index) => {
    const variant = selectCharacterVariantForFrame(manifest, character, frame);
    if (variant === undefined) {
      throw new Error(
        `character variant is missing from the render manifest: ${character.characterId}`
      );
    }

    const source =
      variant.renderType === "single-image"
        ? variant.files.single.path
        : variant.files.closed.path;
    const left = index === 0;
    const size = prioritizeVisual ? "18%" : "25%";
    return (
      <Img
        key={character.characterId}
        src={resolveManifestAssetUrl(source)}
        alt=""
        style={{
          position: "absolute",
          zIndex: 3,
          bottom: prioritizeVisual ? 142 : 124,
          [left ? "left" : "right"]: "4%",
          width: size,
          height: "48%",
          objectFit: "contain",
          objectPosition: "bottom center",
          filter: `drop-shadow(0 12px 18px rgba(7, 16, 31, 0.28))`,
          borderBottom: `7px solid ${
            left ? DESIGN_COLORS.accent : DESIGN_COLORS.caution
          }`
        }}
      />
    );
  });
}
