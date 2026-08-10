import type { ReactNode } from "react";

import { Img } from "remotion";

import type { RenderManifest } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { characterLayerStyle } from "./layout-helpers";
import {
  selectCharacterImagePathForFrame,
  selectCharacterVariantForFrame
} from "./selection";

export function CharacterLayer({
  manifest,
  frame,
  prioritizeVisual,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  manifest: RenderManifest;
  frame: number;
  prioritizeVisual: boolean;
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
    return (
      <Img
        key={character.characterId}
        src={resolveManifestAssetUrl(source, assetUrlResolver)}
        alt={character.displayName}
        data-character-id={character.characterId}
        style={characterLayerStyle(
          index,
          prioritizeVisual,
          character.themeColorToken
        )}
      />
    );
  });
}
