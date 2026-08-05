import { z } from "zod";

import {
  characterVisualAssetPaths,
  type CharacterAssetId
} from "../../assets/character-asset-manifest.js";
import { CURRENT_PROJECT_SCHEMA_VERSION } from "../../schema/video-project.js";

export const LEGACY_PROJECT_SCHEMA_VERSION = "1.0.0" as const;

const legacyMouthPairSchema = z
  .object({
    closed: z.string(),
    open: z.string()
  })
  .strict();

const legacyCharacterVisualAssetsSchema = z
  .object({
    neutral: legacyMouthPairSchema,
    smile: legacyMouthPairSchema,
    explain: legacyMouthPairSchema,
    caution: legacyMouthPairSchema
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCharacterAssetId(value: unknown): value is CharacterAssetId {
  return value === "character-mentor" || value === "character-learner";
}

/**
 * Converts the 1.0.0 character visual asset shape to the 1.1.0 manifest shape.
 * The old expression paths were generated placeholders, so the canonical
 * paths are selected by character ID rather than guessed expression mappings.
 */
export function migratePersistedProject(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== LEGACY_PROJECT_SCHEMA_VERSION) {
    return value;
  }

  if (!Array.isArray(value.characters)) {
    return value;
  }

  let migrated = false;
  const characters = value.characters.map((character) => {
    if (!isRecord(character) || !isCharacterAssetId(character.id)) {
      return character;
    }

    const legacyAssets = legacyCharacterVisualAssetsSchema.safeParse(
      character.visualAssets
    );
    if (!legacyAssets.success) {
      return character;
    }

    migrated = true;
    return {
      ...character,
      visualAssets: characterVisualAssetPaths(character.id)
    };
  });

  return migrated
    ? {
        ...value,
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        characters
      }
    : value;
}
