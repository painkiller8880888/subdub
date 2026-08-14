import { type CharacterVariant } from "../../assets/character-asset-manifest.js";
import type { LegacyCharacterVisualVariant } from "./character-visual-service.js";
import { legacyCharacterVariantCatalog } from "./legacy-character-visual-catalog.js";

export { legacyCharacterVariantCatalog } from "./legacy-character-visual-catalog.js";

/**
 * The legacy array is an input fixture for the one-time migration only. The
 * runtime catalog is read from CharacterVisualRepository after seeding.
 */
export const legacyCharacterVisualSeed: readonly LegacyCharacterVisualVariant[] =
  legacyCharacterVariantCatalog.map(
    (variant: CharacterVariant): LegacyCharacterVisualVariant => ({
      variantId: variant.variantId,
      characterId: variant.characterId,
      label: variant.label,
      renderType: variant.renderType,
      tags: variant.tags,
      files: variant.files.map((file) => ({
        key: file.key,
        sourceFile: file.sourceFile
      }))
    })
  );

export const legacyCharacterVisualNames = {
  "character-learner": "character-learner",
  "character-mentor": "character-mentor"
} as const;

export const legacyCharacterVisualDescriptions = {
  "character-learner":
    "Initial learner character visual set migrated from the legacy catalog.",
  "character-mentor":
    "Initial mentor character visual set migrated from the legacy catalog."
} as const;
