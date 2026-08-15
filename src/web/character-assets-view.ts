import {
  characterVisualSnapshotToVariantCatalog,
  type CharacterVariantCatalog,
  type CharacterVariantRenderType
} from "../assets/character-asset-manifest.js";
import type { CharacterVisualCatalogSnapshot } from "../schema/character-visual.js";
import type { Character, VideoProject } from "../schema/index.js";

export type CharacterAssetVariantFileView = {
  readonly key: string;
  readonly path: string;
};

export type CharacterAssetVariantView = {
  readonly variantId: string;
  readonly label: string;
  readonly renderType: CharacterVariantRenderType;
  readonly tags: readonly string[];
  readonly files: readonly CharacterAssetVariantFileView[];
};

export type CharacterAssetViewModel = {
  readonly id: Character["id"];
  readonly name: string;
  readonly role: Character["role"];
  readonly speakerName: Character["voicevox"]["speakerName"];
  readonly styleName: Character["voicevox"]["styleName"];
  readonly availableVariants: readonly CharacterAssetVariantView[];
};

export function toCharacterAssetViewModel(
  character: Character,
  catalog: CharacterVariantCatalog
): CharacterAssetViewModel {
  const visualId = character.characterVisual.visualId;
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    speakerName: character.voicevox.speakerName,
    styleName: character.voicevox.styleName,
    availableVariants:
      visualId === null
        ? []
        : catalog
            .filter((variant) => variant.characterId === visualId)
            .map((variant) => ({
              variantId: variant.variantId,
              label: variant.label,
              renderType: variant.renderType,
              tags: variant.tags,
              files: variant.files.map((file) => ({
                key: file.key,
                path: file.destinationPath
              }))
            }))
  };
}

export function toCharacterAssetViewModels(
  project: VideoProject,
  catalog: CharacterVariantCatalog
): CharacterAssetViewModel[] {
  return project.characters.map((character) =>
    toCharacterAssetViewModel(character, catalog)
  );
}

export function characterVisualSnapshotToCharacterAssetCatalog(
  snapshot: CharacterVisualCatalogSnapshot
): CharacterVariantCatalog {
  return characterVisualSnapshotToVariantCatalog(snapshot).map((variant) => ({
    ...variant,
    files: variant.files.map((file) => ({
      ...file,
      destinationPath: [
        "api/character-visuals",
        encodeURIComponent(variant.characterId),
        encodeURIComponent(variant.variantId),
        encodeURIComponent(file.key)
      ].join("/")
    }))
  }));
}

export function characterAssetUrl(assetPath: string): string {
  return `/${assetPath}`;
}
