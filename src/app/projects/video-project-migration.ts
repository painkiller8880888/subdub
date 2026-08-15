import { createHash } from "node:crypto";

import type { CharacterVisualBinding } from "../../schema/video-project.js";
import {
  legacyVideoProjectSchema,
  legacyVideoProjectV11Schema
} from "../../schema/video-project.js";

export const CURRENT_VIDEO_PROJECT_SCHEMA_VERSION = "1.2.0" as const;
export const LEGACY_VIDEO_PROJECT_SCHEMA_VERSION = "1.0.0" as const;
export const PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION = "1.1.0" as const;

export type LegacyVideoProjectSchemaVersion =
  | typeof LEGACY_VIDEO_PROJECT_SCHEMA_VERSION
  | typeof PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION;

export type LegacyBgmMigrationLogEntry = {
  readonly migrationId: string;
  readonly fromSchemaVersion: LegacyVideoProjectSchemaVersion;
  readonly toSchemaVersion: typeof CURRENT_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly kind: "unresolved_legacy_bgm";
  readonly sectionId: string;
  readonly legacyPath: string;
  readonly legacyVolume: number;
  readonly reason: string;
};

export type VideoProjectMigrationResult = {
  readonly project: unknown;
  readonly migrated: boolean;
  readonly migrationId: string | undefined;
  readonly logEntries: readonly LegacyBgmMigrationLogEntry[];
};

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

function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!isRecord(value)) {
    throw new Error("Unsupported value in migration input.");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function migrationId(
  project: unknown,
  fromSchemaVersion: LegacyVideoProjectSchemaVersion
): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        fromSchemaVersion,
        toSchemaVersion: CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
        project
      }),
      "utf8"
    )
    .digest("hex");
  return `video-project-migration-${digest}`;
}

function convertLegacyVideoDisplays(
  visuals: Record<string, unknown> | undefined
): void {
  if (!isRecord(visuals) || !Array.isArray(visuals.assignments)) {
    return;
  }

  for (const rawAssignment of visuals.assignments) {
    if (!isRecord(rawAssignment) || !isRecord(rawAssignment.display)) {
      continue;
    }
    const display = rawAssignment.display;
    if (display.kind !== "video" || typeof display.muted !== "boolean") {
      continue;
    }
    display.volume = display.muted ? 0 : 1;
    delete display.muted;
  }
}

function migrateLegacyProject(
  project: Record<string, unknown>,
  fromSchemaVersion: LegacyVideoProjectSchemaVersion
): VideoProjectMigrationResult {
  const legacyResult =
    fromSchemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION
      ? legacyVideoProjectSchema.safeParse(project)
      : legacyVideoProjectV11Schema.safeParse(project);

  // Validate the actual legacy shape before changing the version. In
  // particular, strict legacy objects reject current-only fields instead of
  // allowing new data to bypass the migration boundary.
  if (!legacyResult.success) {
    return {
      project,
      migrated: false,
      migrationId: undefined,
      logEntries: []
    };
  }

  const currentMigrationId = migrationId(project, fromSchemaVersion);
  const migrated = cloneJson(project);
  if (!isRecord(migrated)) {
    return {
      project: migrated,
      migrated: false,
      migrationId: undefined,
      logEntries: []
    };
  }

  migrated.schemaVersion = CURRENT_VIDEO_PROJECT_SCHEMA_VERSION;

  if (fromSchemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION) {
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
        rawCharacter.characterVisual =
          compatibility?.binding ?? { visualId: null, idleVariantId: null };
        return rawCharacter;
      });
    }

    if (isRecord(migrated.script) && Array.isArray(migrated.script.sections)) {
      migrated.script.sections = migrated.script.sections.map((rawSection) => {
        if (!isRecord(rawSection) || !Array.isArray(rawSection.lines)) {
          return rawSection;
        }
        rawSection.lines = rawSection.lines.map((rawLine) => {
          if (!isRecord(rawLine)) {
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
  }

  convertLegacyVideoDisplays(
    isRecord(migrated.visuals) ? migrated.visuals : undefined
  );

  const legacyAudio = isRecord(migrated.audio) ? migrated.audio : undefined;
  const legacyBgms =
    legacyAudio !== undefined && Array.isArray(legacyAudio.sectionBgms)
      ? legacyAudio.sectionBgms
      : [];
  const logEntries: LegacyBgmMigrationLogEntry[] = legacyBgms.flatMap(
    (rawBgm) => {
      if (!isRecord(rawBgm)) {
        return [];
      }
      const sectionId = rawBgm.sectionId;
      const legacyPath = rawBgm.path;
      const legacyVolume = rawBgm.volume;
      if (
        typeof sectionId !== "string" ||
        typeof legacyPath !== "string" ||
        typeof legacyVolume !== "number"
      ) {
        return [];
      }
      return [
        {
          migrationId: currentMigrationId,
          fromSchemaVersion,
          toSchemaVersion: CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
          kind: "unresolved_legacy_bgm" as const,
          sectionId,
          legacyPath,
          legacyVolume,
          reason:
            "The legacy BGM path cannot be resolved to a registered Asset during the 1.2.0 migration."
        }
      ];
    }
  );

  // Old BGM paths and placeholder inserts are intentionally not promoted to
  // current project data. ED-02+ re-registration is the only way to select
  // those assets again.
  migrated.audio = {
    soundEffects:
      legacyAudio !== undefined && Array.isArray(legacyAudio.soundEffects)
        ? legacyAudio.soundEffects
        : []
  };
  migrated.edit = { videoElements: [], sectionBgms: [] };
  delete migrated.inserts;

  return {
    project: migrated,
    migrated: true,
    migrationId: currentMigrationId,
    logEntries
  };
}

export function migrateVideoProjectWithDiagnostics(
  input: unknown
): VideoProjectMigrationResult {
  if (!isRecord(input)) {
    return {
      project: input,
      migrated: false,
      migrationId: undefined,
      logEntries: []
    };
  }
  if (input.schemaVersion === CURRENT_VIDEO_PROJECT_SCHEMA_VERSION) {
    return {
      project: input,
      migrated: false,
      migrationId: undefined,
      logEntries: []
    };
  }
  if (input.schemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION) {
    return migrateLegacyProject(input, LEGACY_VIDEO_PROJECT_SCHEMA_VERSION);
  }
  if (input.schemaVersion === PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION) {
    return migrateLegacyProject(input, PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION);
  }
  return {
    project: input,
    migrated: false,
    migrationId: undefined,
    logEntries: []
  };
}

/**
 * Upgrade a JSON-decoded project without changing the caller's object. The
 * repository persists the returned 1.2.0 value only after migration
 * diagnostics have been durably recorded.
 */
export function migrateVideoProject(input: unknown): unknown {
  return migrateVideoProjectWithDiagnostics(input).project;
}
