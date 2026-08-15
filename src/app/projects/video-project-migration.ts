import type { CharacterVisualBinding } from "../../schema/video-project.js";
import { legacyVideoProjectSchema } from "../../schema/video-project.js";

export const CURRENT_VIDEO_PROJECT_SCHEMA_VERSION = "1.1.0" as const;
export const LEGACY_VIDEO_PROJECT_SCHEMA_VERSION = "1.0.0" as const;

type LegacyCharacterCompatibility = {
  readonly binding: CharacterVisualBinding;
  readonly variants: Readonly<
    Record<"neutral" | "smile" | "explain" | "caution", string>
  >;
};

/**
 * This is the only compatibility mapping used by the 1.0.0 migration. It is
 * deliberately keyed by the old stable IDs; no catalog tags, labels, or
 * expression search is performed during migration.
 */
export const LEGACY_CHARACTER_VISUAL_COMPATIBILITY: Readonly<
  Record<string, LegacyCharacterCompatibility>
> = {
  "character-mentor": {
    binding: {
      visualId: "character-mentor",
      idleVariantId: "character-mentor-stand-v1"
    },
    variants: {
      neutral: "character-mentor-speak-normal-v1",
      smile: "character-mentor-speak-normal-v1",
      explain: "character-mentor-speak-pointing-v1",
      caution: "character-mentor-speak-pointing-v1"
    }
  },
  "character-learner": {
    binding: {
      visualId: "character-learner",
      idleVariantId: "character-learner-stand-v1"
    },
    variants: {
      neutral: "character-learner-speak-normal-v1",
      smile: "character-learner-speak-normal-v1",
      explain: "character-learner-speak-pointing-v1",
      caution: "character-learner-speak-pointing-v1"
    }
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cloneJson(value: unknown): unknown {
  return structuredClone(value);
}

function migrateLegacyProject(project: Record<string, unknown>): unknown {
  // Validate the actual 1.0.0 shape before changing the version. In
  // particular, strict legacy objects reject characterVisual and
  // characterVariantId instead of allowing 1.1.0-only data to bypass the
  // legacy schema boundary.
  if (!legacyVideoProjectSchema.safeParse(project).success) {
    return project;
  }

  const migrated = cloneJson(project);
  if (!isRecord(migrated)) {
    return migrated;
  }

  migrated.schemaVersion = CURRENT_VIDEO_PROJECT_SCHEMA_VERSION;

  if (Array.isArray(migrated.characters)) {
    migrated.characters = migrated.characters.map((rawCharacter) => {
      if (!isRecord(rawCharacter)) {
        return rawCharacter;
      }
      const characterId = rawCharacter.id;
      const compatibility =
        typeof characterId === "string"
          ? LEGACY_CHARACTER_VISUAL_COMPATIBILITY[characterId]
          : undefined;
      if (rawCharacter.characterVisual === undefined) {
        rawCharacter.characterVisual =
          compatibility?.binding ?? { visualId: null, idleVariantId: null };
      }
      return rawCharacter;
    });
  }

  if (isRecord(migrated.script) && Array.isArray(migrated.script.sections)) {
    migrated.script.sections = migrated.script.sections.map((rawSection) => {
      if (!isRecord(rawSection) || !Array.isArray(rawSection.lines)) {
        return rawSection;
      }
      rawSection.lines = rawSection.lines.map((rawLine) => {
        if (!isRecord(rawLine) || rawLine.characterVariantId !== undefined) {
          return rawLine;
        }
        const speakerId = rawLine.speakerId;
        const expression = rawLine.expression;
        const compatibility =
          typeof speakerId === "string"
            ? LEGACY_CHARACTER_VISUAL_COMPATIBILITY[speakerId]
            : undefined;
        rawLine.characterVariantId =
          compatibility !== undefined &&
          (expression === "neutral" ||
            expression === "smile" ||
            expression === "explain" ||
            expression === "caution")
            ? compatibility.variants[expression]
            : null;
        return rawLine;
      });
      return rawSection;
    });
  }

  return migrated;
}

/**
 * Upgrade a JSON-decoded project without writing it. The repository writes the
 * returned 1.1.0 value only as part of an ordinary revision-checked save, so a
 * failed migration can never replace the original project.json.
 */
export function migrateVideoProject(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }
  if (input.schemaVersion === CURRENT_VIDEO_PROJECT_SCHEMA_VERSION) {
    return input;
  }
  if (input.schemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION) {
    return migrateLegacyProject(input);
  }
  return input;
}
