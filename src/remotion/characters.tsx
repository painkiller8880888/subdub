import type { ReactNode } from "react";

import { Img } from "remotion";

import type { RenderManifest, ResolvedScreenLayout } from "../schema/index";
import { screenTransformStyle } from "../screen-layout-resolver";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import {
  characterLayerStyle,
  resolveCharacterThemeColor
} from "./layout-helpers";
import {
  selectCharacterImagePathForFrame,
  selectCharacterVariantForFrame
} from "./selection";

export function CharacterLayer({
  manifest,
  frame,
  layout,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  manifest: RenderManifest;
  frame: number;
  layout?: ResolvedScreenLayout;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  const characters = manifest.characters.slice(0, 2);
  return characters.map((character, index) => {
    const variant = selectCharacterVariantForFrame(manifest, character, frame);
    if (variant === undefined) {
      throw new Error(
        `character variant is missing from the render manifest: ${character.characterId}`
      );
    }

    const source = selectCharacterImagePathForFrame(manifest, character, frame);
    if (source === undefined) {
      throw new Error(
        `character image is missing from the render manifest: ${character.characterId}`
      );
    }
    const resolvedElement = layout?.elements.find(
      (
        element
      ): element is Extract<
        ResolvedScreenLayout["elements"][number],
        { type: "character-visual" }
      > =>
        element.type === "character-visual" &&
        element.characterId === character.characterId
    );
    const resolvedStyle =
      resolvedElement === undefined
        ? undefined
        : screenTransformStyle(resolvedElement.transform);
    return (
      <Img
        key={character.characterId}
        src={resolveManifestAssetUrl(source, assetUrlResolver)}
        alt={character.displayName}
        data-character-id={character.characterId}
        style={
          resolvedStyle === undefined
            ? characterLayerStyle(index, false, character.themeColorToken)
            : {
                ...resolvedStyle,
                zIndex: 3,
                objectFit: "contain",
                objectPosition: "bottom center",
                filter: "drop-shadow(0 12px 18px rgba(7, 16, 31, 0.28))",
                borderBottom: `7px solid ${resolveCharacterThemeColor(
                  character.themeColorToken
                )}`,
                transform: `${resolvedStyle.transform}${
                  resolvedElement?.flipX ? " scaleX(-1)" : ""
                }`
              }
        }
      />
    );
  });
}
