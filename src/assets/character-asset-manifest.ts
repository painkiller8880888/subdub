import type { CharacterVisualCatalogSnapshot } from "../schema/character-visual.js";

export const CHARACTER_CANVAS_SIZE = {
  width: 600,
  height: 1000
} as const;

export const CHARACTER_VARIANT_CATALOG_VERSION = "1.0.0" as const;
/**
 * Compatibility metadata for existing manifest consumers. CV-05 does not use
 * this mapping table to resolve project line selections.
 */
export const CHARACTER_VARIANT_MAPPING_VERSION = "1.0.0" as const;

export type CharacterVariantRenderType = "single-image" | "mouth-pair";

export type CharacterVariantFile = {
  readonly key: string;
  readonly sourceFile: string;
  readonly destinationPath: string;
};

export type CharacterVariant = {
  readonly variantId: string;
  readonly characterId: string;
  readonly label: string;
  readonly renderType: CharacterVariantRenderType;
  readonly tags: readonly string[];
  readonly files: readonly CharacterVariantFile[];
};

export type CharacterVariantCatalog = readonly CharacterVariant[];

export type CharacterVariantMappingExpression =
  "idle" | "neutral" | "smile" | "explain" | "caution";

export type CharacterVariantMapping = Readonly<
  Record<string, Readonly<Record<CharacterVariantMappingExpression, string>>>
>;

/**
 * Logical expressions are intentionally resolved by an explicit table. The
 * catalog tags are descriptive metadata and must not participate in mapping.
 */
export const characterVariantMapping = {
  "character-mentor": {
    idle: "character-mentor-stand-v1",
    neutral: "character-mentor-speak-normal-v1",
    smile: "character-mentor-speak-normal-v1",
    explain: "character-mentor-speak-pointing-v1",
    caution: "character-mentor-speak-pointing-v1"
  },
  "character-learner": {
    idle: "character-learner-stand-v1",
    neutral: "character-learner-speak-normal-v1",
    smile: "character-learner-speak-normal-v1",
    explain: "character-learner-speak-pointing-v1",
    caution: "character-learner-speak-pointing-v1"
  }
} as const satisfies CharacterVariantMapping;

export function characterVisualSnapshotToVariantCatalog(
  snapshot: CharacterVisualCatalogSnapshot
): CharacterVariantCatalog {
  return snapshot.flatMap((visual) =>
    visual.status === "active"
      ? visual.variants
          .filter((variant) => variant.status === "active")
          .map((variant) => ({
            variantId: variant.variantId,
            characterId: visual.visualId,
            label: variant.label,
            renderType: variant.renderType,
            tags: variant.tags,
            files: variant.files.map((file) => ({
              key: file.key,
              sourceFile: file.libraryPath,
              destinationPath: file.libraryPath
            }))
          }))
      : []
  );
}

export function characterVisualSnapshotToAssetMetadata(
  snapshot: CharacterVisualCatalogSnapshot
): readonly {
  readonly path: string;
  readonly kind: "character";
  readonly sha256: string;
  readonly durationMs: null;
}[] {
  return snapshot.flatMap((visual) =>
    visual.status === "active"
      ? visual.variants
          .filter((variant) => variant.status === "active")
          .flatMap((variant) =>
            variant.files.map((file) => ({
              path: file.libraryPath,
              kind: "character" as const,
              sha256: file.checksum,
              durationMs: null
            }))
          )
      : []
  );
}

export type CharacterAssetId = string;

export function characterVariantsForCharacter(
  characterId: string,
  catalog: CharacterVariantCatalog
): readonly CharacterVariant[] {
  return catalog.filter((variant) => variant.characterId === characterId);
}

export function resolveCharacterVariantId(
  characterId: string,
  expression: CharacterVariantMappingExpression,
  mapping: CharacterVariantMapping = characterVariantMapping
): string | undefined {
  return mapping[characterId]?.[expression];
}
