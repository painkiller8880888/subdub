import { createHash } from "node:crypto";

import type { CharacterVisualBinding } from "../../schema/video-project.js";
import {
  legacyVideoProjectSchema,
  legacyVideoProjectV11Schema,
  videoProjectV12Schema,
  videoProjectV13Schema,
  videoProjectV14Schema,
  videoProjectV15Schema,
  videoProjectV16Schema,
  videoProjectV17Schema,
  videoProjectV18Schema
} from "../../schema/video-project.js";
import { STANDARD_SCREEN_TEMPLATE_ID } from "../screen-templates/screen-template-seed.js";
import { createStarterScriptSections } from "./starter-script-sections.js";
import type { ScreenTemplateCatalogPort } from "./screen-template-selection.js";

export const CURRENT_VIDEO_PROJECT_SCHEMA_VERSION = "1.9.0" as const;
export const PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION = "1.8.0" as const;
export const LINE_OVERLAY_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.7.0" as const;
export const EDIT_VIDEO_TIMING_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.6.0" as const;
export const INSERT_TEXT_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.5.0" as const;
export const PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.4.0" as const;
export const SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.2.0" as const;
export const LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION =
  "1.3.0" as const;
export const LEGACY_VIDEO_PROJECT_SCHEMA_VERSION = "1.0.0" as const;
export const PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION = "1.1.0" as const;

export type LegacyVideoProjectSchemaVersion =
  | typeof LEGACY_VIDEO_PROJECT_SCHEMA_VERSION
  | typeof PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION;

export type LegacyBgmMigrationLogEntry = {
  readonly migrationId: string;
  readonly fromSchemaVersion: LegacyVideoProjectSchemaVersion;
  readonly toSchemaVersion: typeof SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly kind: "unresolved_legacy_bgm";
  readonly sectionId: string;
  readonly legacyPath: string;
  readonly legacyVolume: number;
  readonly reason: string;
};

export type ScreenTemplateMigrationLogEntry = {
  readonly migrationId: string;
  readonly fromSchemaVersion: typeof SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly toSchemaVersion: typeof LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly kind: "screen_template_selection";
  readonly templateId: typeof STANDARD_SCREEN_TEMPLATE_ID;
  readonly sectionCount: number;
  readonly lineCount: number;
  readonly visualAssignmentCount: number;
};

export type LineScreenTemplateOverrideMigrationLogEntry = {
  readonly migrationId: string;
  readonly fromSchemaVersion: typeof LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly toSchemaVersion: typeof PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly kind: "removed_line_screen_template_override";
  readonly sectionId: string;
  readonly lineId: string;
  readonly oldLineScreenTemplateId: string;
  readonly effectiveSectionScreenTemplateId: string;
};

export type VideoProjectV19MigrationLogEntry = {
  readonly migrationId: string;
  readonly fromSchemaVersion: typeof PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly toSchemaVersion: typeof CURRENT_VIDEO_PROJECT_SCHEMA_VERSION;
  readonly kind: "video_project_v19_shape";
  readonly removedRootFields: readonly ["source", "brief", "outline"];
  readonly existingOutlineSectionCount: number;
  readonly existingScriptSectionCount: number;
  readonly starterSectionsCreated: boolean;
};

export type ProjectMigrationLogEntry =
  | LegacyBgmMigrationLogEntry
  | ScreenTemplateMigrationLogEntry
  | LineScreenTemplateOverrideMigrationLogEntry
  | VideoProjectV19MigrationLogEntry;

export type VideoProjectMigrationOptions = Readonly<{
  /** Live catalog lookup used by the repository/application boundary. */
  readonly screenTemplateCatalog?: ScreenTemplateCatalogPort;
  /** Test/CLI override for the workspace prerequisite check. */
  readonly standardTemplateAvailable?: boolean;
}>;

export type VideoProjectMigrationResult = {
  readonly project: unknown;
  readonly migrated: boolean;
  readonly migrationId: string | undefined;
  readonly logEntries: readonly ProjectMigrationLogEntry[];
  readonly blockedReason: "standard_template_unavailable" | undefined;
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
  fromSchemaVersion:
    | LegacyVideoProjectSchemaVersion
    | typeof SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    | typeof LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    | typeof PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  | typeof INSERT_TEXT_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  | typeof EDIT_VIDEO_TIMING_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    | typeof LINE_OVERLAY_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    | typeof PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
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

function noMigration(
  project: unknown,
  blockedReason: VideoProjectMigrationResult["blockedReason"] = undefined
): VideoProjectMigrationResult {
  return {
    project,
    migrated: false,
    migrationId: undefined,
    logEntries: [],
    blockedReason
  };
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

type LegacyMigrationResult = {
  readonly project: unknown;
  readonly migrationId: string;
  readonly logEntries: readonly LegacyBgmMigrationLogEntry[];
};

function migrateLegacyProject(
  project: Record<string, unknown>,
  fromSchemaVersion: LegacyVideoProjectSchemaVersion
): LegacyMigrationResult | undefined {
  const legacyResult =
    fromSchemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION
      ? legacyVideoProjectSchema.safeParse(project)
      : legacyVideoProjectV11Schema.safeParse(project);

  // Validate the actual legacy shape before changing the version. In
  // particular, strict legacy objects reject current-only fields instead of
  // allowing new data to bypass the migration boundary.
  if (!legacyResult.success) {
    return undefined;
  }

  const currentMigrationId = migrationId(project, fromSchemaVersion);
  const migrated = cloneJson(project);
  if (!isRecord(migrated)) {
    return undefined;
  }

  migrated.schemaVersion = SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;

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
          toSchemaVersion: SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
          kind: "unresolved_legacy_bgm" as const,
          sectionId,
          legacyPath,
          legacyVolume,
          reason:
            "The legacy BGM path cannot be resolved to a registered Asset during the 1.2.0 compatibility migration."
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
    migrationId: currentMigrationId,
    logEntries
  };
}

function standardTemplateIsAvailable(
  options: VideoProjectMigrationOptions
): boolean {
  if (options.standardTemplateAvailable !== undefined) {
    return options.standardTemplateAvailable;
  }
  if (options.screenTemplateCatalog !== undefined) {
    return (
      options.screenTemplateCatalog.findById(STANDARD_SCREEN_TEMPLATE_ID)
        ?.status === "active"
    );
  }
  // The pure migration helper has no workspace to inspect. The application
  // repository supplies the live catalog when it is available.
  return true;
}

function migrateScreenTemplateProject(
  project: unknown,
  currentMigrationId: string
): {
  readonly project: unknown;
  readonly logEntry: ScreenTemplateMigrationLogEntry;
} | undefined {
  const v12Result = videoProjectV12Schema.safeParse(project);
  if (!v12Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v12Result.data);
  if (!isRecord(migrated) || !isRecord(migrated.script)) {
    return undefined;
  }
  migrated.revision = v12Result.data.revision + 1;
  const sections = migrated.script.sections;
  if (!Array.isArray(sections)) {
    return undefined;
  }

  for (const rawSection of sections) {
    if (!isRecord(rawSection) || !Array.isArray(rawSection.lines)) {
      return undefined;
    }
    rawSection.screenTemplateId = STANDARD_SCREEN_TEMPLATE_ID;
    for (const rawLine of rawSection.lines) {
      if (!isRecord(rawLine)) {
        return undefined;
      }
      rawLine.screenTemplateId = null;
    }
  }

  const visuals = migrated.visuals;
  if (!isRecord(visuals) || !Array.isArray(visuals.assignments)) {
    return undefined;
  }
  for (const rawAssignment of visuals.assignments) {
    if (!isRecord(rawAssignment) || !isRecord(rawAssignment.display)) {
      return undefined;
    }
    rawAssignment.display.displayCoordinateSpace = "legacy-media-frame";
  }

  migrated.schemaVersion =
    LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;

  const lineCount = sections.reduce(
    (count, section) =>
      count +
      (isRecord(section) && Array.isArray(section.lines)
        ? section.lines.length
        : 0),
    0
  );
  return {
    project: migrated,
    logEntry: {
      migrationId: currentMigrationId,
      fromSchemaVersion: SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
      toSchemaVersion: LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
      kind: "screen_template_selection",
      templateId: STANDARD_SCREEN_TEMPLATE_ID,
      sectionCount: sections.length,
      lineCount,
      visualAssignmentCount: visuals.assignments.length
    }
  };
}

function migrateLineScreenTemplateOverridesProject(
  project: unknown,
  currentMigrationId: string,
  incrementRevision: boolean
): {
  readonly project: unknown;
  readonly logEntries: readonly LineScreenTemplateOverrideMigrationLogEntry[];
} | undefined {
  const v13Result = videoProjectV13Schema.safeParse(project);
  if (!v13Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v13Result.data);
  if (!isRecord(migrated) || !isRecord(migrated.script)) {
    return undefined;
  }
  migrated.revision =
    v13Result.data.revision + (incrementRevision ? 1 : 0);
  const sections = migrated.script.sections;
  if (!Array.isArray(sections)) {
    return undefined;
  }

  const logEntries: LineScreenTemplateOverrideMigrationLogEntry[] = [];
  for (const rawSection of sections) {
    if (!isRecord(rawSection) || !Array.isArray(rawSection.lines)) {
      return undefined;
    }
    const sectionId = rawSection.id;
    const sectionTemplateId = rawSection.screenTemplateId;
    if (
      typeof sectionId !== "string" ||
      typeof sectionTemplateId !== "string"
    ) {
      return undefined;
    }
    for (const rawLine of rawSection.lines) {
      if (!isRecord(rawLine) || typeof rawLine.id !== "string") {
        return undefined;
      }
      const lineTemplateId = rawLine.screenTemplateId;
      if (typeof lineTemplateId === "string") {
        logEntries.push({
          migrationId: currentMigrationId,
          fromSchemaVersion:
            LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
          toSchemaVersion:
            PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
          kind: "removed_line_screen_template_override",
          sectionId,
          lineId: rawLine.id,
          oldLineScreenTemplateId: lineTemplateId,
          effectiveSectionScreenTemplateId: sectionTemplateId
        });
      }
      delete rawLine.screenTemplateId;
    }
  }

  migrated.schemaVersion =
    PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  return { project: migrated, logEntries };
}

function migratePlaybackCuesProject(
  project: unknown,
  incrementRevision: boolean
): unknown | undefined {
  const v14Result = videoProjectV14Schema.safeParse(project);
  if (!v14Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v14Result.data);
  if (!isRecord(migrated) || !isRecord(migrated.visuals)) {
    return undefined;
  }
  if (!Array.isArray(migrated.visuals.assignments)) {
    return undefined;
  }

  for (const rawAssignment of migrated.visuals.assignments) {
    if (!isRecord(rawAssignment) || !isRecord(rawAssignment.display)) {
      return undefined;
    }
    if (rawAssignment.display.kind === "video") {
      rawAssignment.display.playbackCues = [];
    }
  }

  migrated.schemaVersion = INSERT_TEXT_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  migrated.revision = v14Result.data.revision + (incrementRevision ? 1 : 0);
  return migrated;
}

function migrateInsertTextTemplateProject(
  project: unknown,
  incrementRevision: boolean
): unknown | undefined {
  const v15Result = videoProjectV15Schema.safeParse(project);
  if (!v15Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v15Result.data);
  if (!isRecord(migrated) || !isRecord(migrated.edit)) {
    return undefined;
  }
  if (!Array.isArray(migrated.edit.videoElements)) {
    return undefined;
  }
  migrated.edit.videoElements = migrated.edit.videoElements.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    return {
      ...element,
      text: "",
      textTemplateId: null
    };
  });
  migrated.schemaVersion =
    EDIT_VIDEO_TIMING_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  migrated.revision = v15Result.data.revision + (incrementRevision ? 1 : 0);
  return migrated;
}

function migrateEditVideoTimingProject(
  project: unknown,
  incrementRevision: boolean
): unknown | undefined {
  const v16Result = videoProjectV16Schema.safeParse(project);
  if (!v16Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v16Result.data);
  if (!isRecord(migrated) || !isRecord(migrated.edit)) {
    return undefined;
  }
  if (!Array.isArray(migrated.edit.videoElements)) {
    return undefined;
  }
  migrated.edit.videoElements = migrated.edit.videoElements.map((element) => {
    if (!isRecord(element)) {
      return element;
    }
    return {
      ...element,
      startMs: null,
      playbackRate: 1
    };
  });
  migrated.schemaVersion = LINE_OVERLAY_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  migrated.revision = v16Result.data.revision + (incrementRevision ? 1 : 0);
  return migrated;
}

function migrateLineOverlaysProject(
  project: unknown,
  incrementRevision: boolean
): unknown | undefined {
  const v17Result = videoProjectV17Schema.safeParse(project);
  if (!v17Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v17Result.data);
  if (!isRecord(migrated)) {
    return undefined;
  }
  migrated.overlays = { lineOverlays: [] };
  migrated.schemaVersion = PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  migrated.revision = v17Result.data.revision + (incrementRevision ? 1 : 0);
  return migrated;
}

function migrateVideoProjectV18ToV19(
  project: unknown,
  currentMigrationId: string
): {
  readonly project: unknown;
  readonly logEntry: VideoProjectV19MigrationLogEntry;
} | undefined {
  const v18Result = videoProjectV18Schema.safeParse(project);
  if (!v18Result.success) {
    return undefined;
  }

  const migrated = cloneJson(v18Result.data);
  if (
    !isRecord(migrated) ||
    !isRecord(migrated.aiSettings) ||
    !isRecord(migrated.script) ||
    !Array.isArray(migrated.script.sections)
  ) {
    return undefined;
  }

  const existingScriptSectionCount = migrated.script.sections.length;
  const existingOutlineSectionCount =
    isRecord(migrated.outline) && Array.isArray(migrated.outline.sections)
      ? migrated.outline.sections.length
      : 0;
  const starterSectionsCreated = existingScriptSectionCount === 0;

  const scriptSections = starterSectionsCreated
    ? createStarterScriptSections(
        isRecord(migrated.metadata) && typeof migrated.metadata.id === "string"
          ? migrated.metadata.id
          : "project"
      )
    : migrated.script.sections.map((rawSection) => {
        if (!isRecord(rawSection)) {
          return rawSection;
        }
        const section = { ...rawSection };
        delete section.outlineSectionId;
        return { ...section, enabled: true };
      });

  const legacyTaskModelOverrides = migrated.aiSettings.taskModelOverrides;
  if (!isRecord(legacyTaskModelOverrides)) {
    return undefined;
  }
  const taskModelOverrides: Record<string, string> = {};
  for (const taskKind of [
    "visual_search_intent",
    "layout_review",
    "opencode"
  ] as const) {
    const modelId = legacyTaskModelOverrides[taskKind];
    if (typeof modelId === "string") {
      taskModelOverrides[taskKind] = modelId;
    }
  }

  migrated.schemaVersion = CURRENT_VIDEO_PROJECT_SCHEMA_VERSION;
  migrated.revision = v18Result.data.revision + 1;
  migrated.aiSettings = {
    ...migrated.aiSettings,
    taskModelOverrides
  };
  migrated.script = { sections: scriptSections };
  delete migrated.source;
  delete migrated.brief;
  delete migrated.outline;

  return {
    project: migrated,
    logEntry: {
      migrationId: currentMigrationId,
      fromSchemaVersion: PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION,
      toSchemaVersion: CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
      kind: "video_project_v19_shape",
      removedRootFields: ["source", "brief", "outline"],
      existingOutlineSectionCount,
      existingScriptSectionCount,
      starterSectionsCreated
    }
  };
}

function completeV18Migration(
  project: unknown,
  currentMigrationId: string
): {
  readonly project: unknown;
  readonly logEntry: VideoProjectV19MigrationLogEntry;
} | undefined {
  return migrateVideoProjectV18ToV19(project, currentMigrationId);
}

export function migrateVideoProjectWithDiagnostics(
  input: unknown,
  options: VideoProjectMigrationOptions = {}
): VideoProjectMigrationResult {
  if (!isRecord(input)) {
    return noMigration(input);
  }
  if (input.schemaVersion === CURRENT_VIDEO_PROJECT_SCHEMA_VERSION) {
    return noMigration(input);
  }

  if (input.schemaVersion === PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION) {
    const currentMigrationId = migrationId(
      input,
      PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    );
    const migrated = completeV18Migration(input, currentMigrationId);
    if (migrated === undefined) {
      return noMigration(input);
    }
    return {
      project: migrated.project,
      migrated: true,
      migrationId: currentMigrationId,
      logEntries: [migrated.logEntry],
      blockedReason: undefined
    };
  }

  if (
    input.schemaVersion ===
    LINE_OVERLAY_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    const currentMigrationId = migrationId(
      input,
      LINE_OVERLAY_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    );
    const lineOverlayMigration = migrateLineOverlaysProject(input, true);
    if (lineOverlayMigration === undefined) {
      return noMigration(input);
    }
    const migrated = completeV18Migration(
      lineOverlayMigration,
      currentMigrationId
    );
    if (migrated === undefined) {
      return noMigration(input);
    }
    return {
      project: migrated.project,
      migrated: true,
      migrationId: currentMigrationId,
      logEntries: [migrated.logEntry],
      blockedReason: undefined
    };
  }

  if (
    input.schemaVersion ===
    EDIT_VIDEO_TIMING_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    const currentMigrationId = migrationId(
      input,
      EDIT_VIDEO_TIMING_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    );
    const editVideoTimingMigration = migrateEditVideoTimingProject(input, true);
    if (editVideoTimingMigration === undefined) {
      return noMigration(input);
    }
    const migrated = migrateLineOverlaysProject(editVideoTimingMigration, true);
    if (migrated === undefined) {
      return noMigration(input);
    }
    const v19Migration = completeV18Migration(migrated, currentMigrationId);
    if (v19Migration === undefined) {
      return noMigration(input);
    }
    return {
      project: v19Migration.project,
      migrated: true,
      migrationId: currentMigrationId,
      logEntries: [v19Migration.logEntry],
      blockedReason: undefined
    };
  }

  if (
    input.schemaVersion ===
    INSERT_TEXT_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    const currentMigrationId = migrationId(
      input,
      INSERT_TEXT_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    );
    const insertTextMigration = migrateInsertTextTemplateProject(input, true);
    if (insertTextMigration === undefined) {
      return noMigration(input);
    }
    const editVideoTimingMigration = migrateEditVideoTimingProject(
      insertTextMigration,
      true
    );
    if (editVideoTimingMigration === undefined) {
      return noMigration(input);
    }
    const migrated = migrateLineOverlaysProject(editVideoTimingMigration, true);
    if (migrated === undefined) {
      return noMigration(input);
    }
    const v19Migration = completeV18Migration(migrated, currentMigrationId);
    if (v19Migration === undefined) {
      return noMigration(input);
    }
    return {
      project: v19Migration.project,
      migrated: true,
      migrationId: currentMigrationId,
      logEntries: [v19Migration.logEntry],
      blockedReason: undefined
    };
  }

  if (
    input.schemaVersion ===
    PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    const currentMigrationId = migrationId(
      input,
      PLAYBACK_CUE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    );
    const playbackCueMigration = migratePlaybackCuesProject(input, true);
    if (playbackCueMigration === undefined) {
      return noMigration(input);
    }
    const migrated = migrateInsertTextTemplateProject(
      playbackCueMigration,
      true
    );
    if (migrated === undefined) {
      return noMigration(input);
    }
    const editVideoTimingMigration = migrateEditVideoTimingProject(
      migrated,
      true
    );
    if (editVideoTimingMigration === undefined) {
      return noMigration(input);
    }
    const lineOverlayMigration = migrateLineOverlaysProject(
      editVideoTimingMigration,
      true
    );
    if (lineOverlayMigration === undefined) {
      return noMigration(input);
    }
    const v19Migration = completeV18Migration(
      lineOverlayMigration,
      currentMigrationId
    );
    if (v19Migration === undefined) {
      return noMigration(input);
    }
    return {
      project: v19Migration.project,
      migrated: true,
      migrationId: currentMigrationId,
      logEntries: [v19Migration.logEntry],
      blockedReason: undefined
    };
  }

  let sourceProject: unknown = input;
  let fromSchemaVersion:
    | LegacyVideoProjectSchemaVersion
    | typeof SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
    | typeof LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  let legacyLogEntries: readonly LegacyBgmMigrationLogEntry[] = [];
  let currentMigrationId: string;

  if (
    input.schemaVersion === LEGACY_VIDEO_PROJECT_SCHEMA_VERSION ||
    input.schemaVersion === PRE_EDIT_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    fromSchemaVersion = input.schemaVersion;
    const legacyMigration = migrateLegacyProject(input, fromSchemaVersion);
    if (legacyMigration === undefined) {
      return noMigration(input);
    }
    sourceProject = legacyMigration.project;
    legacyLogEntries = legacyMigration.logEntries;
    currentMigrationId = legacyMigration.migrationId;
  } else if (
    input.schemaVersion === SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    fromSchemaVersion = SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
    currentMigrationId = migrationId(input, fromSchemaVersion);
  } else if (
    input.schemaVersion ===
    LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION
  ) {
    fromSchemaVersion =
      LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
    currentMigrationId = migrationId(input, fromSchemaVersion);
  } else {
    return noMigration(input);
  }

  let screenTemplateLogEntries: readonly ScreenTemplateMigrationLogEntry[] = [];
  const migratingFromLineOverrideVersion =
    input.schemaVersion ===
    LINE_SCREEN_TEMPLATE_PREVIOUS_VIDEO_PROJECT_SCHEMA_VERSION;
  if (!migratingFromLineOverrideVersion) {
    if (!standardTemplateIsAvailable(options)) {
      return noMigration(input, "standard_template_unavailable");
    }
    const screenTemplateMigration = migrateScreenTemplateProject(
      sourceProject,
      currentMigrationId
    );
    if (screenTemplateMigration === undefined) {
      return noMigration(input);
    }
    sourceProject = screenTemplateMigration.project;
    screenTemplateLogEntries = [screenTemplateMigration.logEntry];
  }

  const lineOverrideMigration = migrateLineScreenTemplateOverridesProject(
    sourceProject,
    currentMigrationId,
    migratingFromLineOverrideVersion
  );
  if (lineOverrideMigration === undefined) {
    return noMigration(input);
  }

  const playbackCueMigration = migratePlaybackCuesProject(
    lineOverrideMigration.project,
    true
  );
  if (playbackCueMigration === undefined) {
    return noMigration(input);
  }

  const insertTextTemplateMigration = migrateInsertTextTemplateProject(
    playbackCueMigration,
    true
  );
  if (insertTextTemplateMigration === undefined) {
    return noMigration(input);
  }

  const editVideoTimingMigration = migrateEditVideoTimingProject(
    insertTextTemplateMigration,
    true
  );
  if (editVideoTimingMigration === undefined) {
    return noMigration(input);
  }

  const lineOverlayMigration = migrateLineOverlaysProject(
    editVideoTimingMigration,
    true
  );
  if (lineOverlayMigration === undefined) {
    return noMigration(input);
  }

  const v19Migration = completeV18Migration(
    lineOverlayMigration,
    currentMigrationId
  );
  if (v19Migration === undefined) {
    return noMigration(input);
  }

  return {
    project: v19Migration.project,
    migrated: true,
    migrationId: currentMigrationId,
    logEntries: [
      ...legacyLogEntries,
      ...screenTemplateLogEntries,
      ...lineOverrideMigration.logEntries,
      v19Migration.logEntry
    ],
    blockedReason: undefined
  };
}

/** Upgrade a JSON-decoded project without changing the caller's object. */
export function migrateVideoProject(
  input: unknown,
  options: VideoProjectMigrationOptions = {}
): unknown {
  return migrateVideoProjectWithDiagnostics(input, options).project;
}
