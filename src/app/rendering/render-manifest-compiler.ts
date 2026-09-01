import { createHash } from "node:crypto";
import { z } from "zod";

import {
  CHARACTER_VARIANT_CATALOG_VERSION,
  CHARACTER_VARIANT_MAPPING_VERSION,
  type CharacterVariantMapping,
  type CharacterVariantRenderType
} from "../../assets/character-asset-manifest.js";
import {
  calculateLineRanges,
  calculateEditVideoTimeline,
  calculateSectionRanges,
  calculateVisualRanges,
  msToFrames,
  type TimelineLineRange
} from "../../timeline/index.js";
import {
  idSchema,
  DEFAULT_CHARACTER_VISUAL_GLOW_COLOR,
  DEFAULT_DIALOGUE_WINDOW_BACKGROUND_COLOR,
  DEFAULT_DIALOGUE_WINDOW_BACKGROUND_OPACITY,
  relativePosixPathSchema,
  renderManifestV24Schema,
  renderManifestV25Schema,
  renderManifestV26Schema,
  renderManifestV28Schema,
  renderManifestV29Schema,
  renderManifestSchema,
  sha256Schema,
  characterVisualCatalogSnapshotSchema,
  screenTemplateSchema,
  insertTextTemplateSchema,
  type RenderLayoutInterval,
  type RenderSectionLayout,
  type RenderResolvedVisualDisplay,
  type ResolvedScreenLayout,
  type RenderBackground,
  type RenderCharacter,
  type RenderCharacterVariant,
  type RenderLine,
  type RenderLineV24,
  type RenderManifest,
  type RenderManifestV24,
  type RenderManifestV25,
  type RenderManifestV26,
  type RenderManifestV27,
  type RenderManifestV28,
  type RenderManifestV29,
  type RenderLineOverlay,
  type RenderResolvedVideoDisplayV25,
  type RenderInsert,
  type RenderInsertV27,
  type RenderInsertV28,
  type RenderInsertTextSnapshot,
  type RenderSoundEffect,
  type RenderVisualV24,
  type RenderVisualV25,
  type ResolvedScreenElementV26,
  type ResolvedScreenLayoutV26,
  type ScreenTemplate,
  videoProjectSchema
} from "../../schema/index.js";
import {
  voicevoxAudioIndexSchema,
  type VoicevoxAudioIndexEntry
} from "../voicevox/audio-index.js";
import {
  resolveScreenTemplateLayout,
  resolveVisualDisplay
} from "../screen-templates/screen-layout-resolver.js";
import {
  screenTemplateContentHash,
  screenTemplateLegacyContentHash
} from "../screen-templates/screen-template-hash.js";
import { insertTextTemplateContentHash } from "../insert-text-templates/insert-text-template-hash.js";
import type { InsertTextTemplate } from "../../schema/insert-text-template.js";
import {
  resolvedScreenLayoutValidationIssues,
  screenTemplateTextValidationIssues,
  screenTemplateValidationReport
} from "../../validation/screen-templates.js";
import {
  effectiveMediaDurationInFrames,
  mediaMillisecondsToFrames,
  presentationFramesToMediaPosition
} from "../../media-frame.js";
import { validateVisualPlaybackSequence } from "../../timeline/visual-playback.js";
import type { VisualPlaybackCue } from "../../schema/visual-playback.js";

export const RENDER_MANIFEST_VERSION = "2.9.0" as const;
export const RENDER_MANIFEST_V28_VERSION = "2.8.0" as const;
export const RENDER_MANIFEST_V27_VERSION = "2.7.0" as const;
export const RENDER_MANIFEST_V26_VERSION = "2.6.0" as const;
export const RENDER_MANIFEST_V25_VERSION = "2.5.0" as const;
export const RENDER_MANIFEST_V24_VERSION = "2.4.0" as const;

export const renderManifestAssetMetadataSchema = z
  .object({
    path: relativePosixPathSchema,
    kind: z.string().min(1),
    sha256: sha256Schema,
    durationMs: z
      .union([z.number().finite().int().nonnegative(), z.null()])
      .optional(),
    pageCount: z
      .union([z.number().finite().int().positive(), z.null()])
      .optional()
  })
  .passthrough();

export type RenderManifestAssetMetadata = z.infer<
  typeof renderManifestAssetMetadataSchema
>;

export const RENDER_MANIFEST_ERROR_CODE = {
  videoProjectSchema: "VIDEO_PROJECT_SCHEMA_INVALID",
  voicevoxAudioIndexSchema: "VOICEVOX_AUDIO_INDEX_SCHEMA_INVALID",
  assetMetadataSchema: "ASSET_METADATA_SCHEMA_INVALID",
  catalogSchema: "CHARACTER_CATALOG_INVALID",
  mappingSchema: "CHARACTER_MAPPING_INVALID",
  catalogVersion: "CHARACTER_CATALOG_VERSION_INVALID",
  mappingVersion: "CHARACTER_MAPPING_VERSION_INVALID",
  outlineNotApproved: "OUTLINE_NOT_APPROVED",
  scriptNotApproved: "SCRIPT_NOT_APPROVED",
  visualsNotApproved: "VISUALS_NOT_APPROVED",
  outlineStale: "OUTLINE_SOURCE_HASH_MISMATCH",
  scriptStale: "SCRIPT_OUTLINE_HASH_MISMATCH",
  emptyScript: "SCRIPT_EMPTY",
  emptySection: "SCRIPT_SECTION_EMPTY",
  audioMissing: "AUDIO_INDEX_ENTRY_MISSING",
  audioAssetMissing: "AUDIO_ASSET_MISSING",
  audioAssetKindMismatch: "AUDIO_ASSET_KIND_MISMATCH",
  audioAssetChecksumMismatch: "AUDIO_ASSET_CHECKSUM_MISMATCH",
  audioDurationMismatch: "AUDIO_DURATION_MISMATCH",
  assetMissing: "ASSET_METADATA_MISSING",
  assetKindMismatch: "ASSET_KIND_MISMATCH",
  assetChecksumMismatch: "ASSET_CHECKSUM_MISMATCH",
  assetDurationMissing: "ASSET_DURATION_MISSING",
  assetDurationInvalid: "ASSET_DURATION_INVALID",
  assetRangeInvalid: "ASSET_RANGE_INVALID",
  editVideoFormatInvalid: "EDIT_VIDEO_FORMAT_INVALID",
  editBgmFormatInvalid: "EDIT_BGM_FORMAT_INVALID",
  legacyVideoVolumeUnsupported: "LEGACY_MANIFEST_VIDEO_VOLUME_UNREPRESENTABLE",
  assetPageCountMissing: "ASSET_PAGE_COUNT_MISSING",
  visualRangeInvalid: "VISUAL_RANGE_INVALID",
  fadeRangeInvalid: "AUDIO_FADE_RANGE_INVALID",
  mappingMissing: "CHARACTER_MAPPING_MISSING",
  characterVisualBindingMissing: "CHARACTER_VISUAL_BINDING_MISSING",
  characterVisualMissing: "CHARACTER_VISUAL_MISSING",
  characterVisualInactive: "CHARACTER_VISUAL_INACTIVE",
  characterVariantUnselected: "CHARACTER_VARIANT_UNSELECTED",
  characterVariantInactive: "CHARACTER_VARIANT_INACTIVE",
  variantMissing: "CHARACTER_VARIANT_MISSING",
  variantCharacterMismatch: "CHARACTER_VARIANT_CHARACTER_MISMATCH",
  variantFileSlotMissing: "CHARACTER_VARIANT_FILE_SLOT_MISSING",
  variantFileMissing: "CHARACTER_VARIANT_FILE_MISSING",
  variantFileKindMismatch: "CHARACTER_VARIANT_FILE_KIND_MISMATCH",
  variantFileChecksumMismatch: "CHARACTER_VARIANT_FILE_CHECKSUM_MISMATCH",
  screenTemplateSchema: "SCREEN_TEMPLATE_SNAPSHOT_INVALID",
  screenTemplateMissing: "SCREEN_TEMPLATE_MISSING",
  screenTemplateInactive: "SCREEN_TEMPLATE_INACTIVE",
  screenTemplateGeometryInvalid: "SCREEN_TEMPLATE_GEOMETRY_INVALID",
  screenTemplateCardinalityInvalid: "SCREEN_TEMPLATE_CARDINALITY_INVALID",
  screenTemplateTextOverflow: "SCREEN_TEMPLATE_TEXT_OVERFLOW",
  insertTextTemplateSchema: "INSERT_TEXT_TEMPLATE_SNAPSHOT_INVALID",
  insertTextTemplateMissing: "INSERT_TEXT_TEMPLATE_MISSING",
  insertTextTemplateInactive: "INSERT_TEXT_TEMPLATE_INACTIVE",
  screenLayoutMissing: "RESOLVED_SCREEN_LAYOUT_MISSING",
  screenLayoutCharacterMissing: "RESOLVED_SCREEN_LAYOUT_CHARACTER_MISSING",
  visualPlaybackCuesUnsupported: "VISUAL_PLAYBACK_CUES_UNSUPPORTED",
  visualPlaybackCueInvalid: "VISUAL_PLAYBACK_CUE_INVALID",
  visualSourceRangeInvalid: "VISUAL_SOURCE_RANGE_INVALID",
  visualSegmentRangeInvalid: "VISUAL_SEGMENT_RANGE_INVALID",
  manifestSchema: "RENDER_MANIFEST_SCHEMA_INVALID"
} as const;

export type RenderManifestDiagnosticCode =
  (typeof RENDER_MANIFEST_ERROR_CODE)[keyof typeof RENDER_MANIFEST_ERROR_CODE];

export type RenderManifestDiagnostic = {
  readonly code: RenderManifestDiagnosticCode;
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly lineId?: string;
  readonly assignmentId?: string;
  readonly sectionId?: string;
  readonly variantId?: string;
  readonly assetPath?: string;
};

export const RENDER_MANIFEST_WARNING_CODE = {
  soundEffectOverlap: "SOUND_EFFECT_OVERLAP_LIMIT"
} as const;

export type RenderManifestWarningCode =
  (typeof RENDER_MANIFEST_WARNING_CODE)[keyof typeof RENDER_MANIFEST_WARNING_CODE];

export type RenderManifestWarning = {
  readonly code: RenderManifestWarningCode;
  readonly message: string;
  readonly from: number;
  readonly to: number;
  readonly soundEffectIds: readonly string[];
  readonly lineIds: readonly string[];
};

export type RenderManifestCompilerInput = {
  readonly project?: unknown;
  readonly videoProject?: unknown;
  readonly audioIndex?: unknown;
  readonly audio?: unknown;
  readonly assetMetadata?: readonly unknown[];
  readonly assets?: readonly unknown[];
  readonly materials?: readonly unknown[];
  readonly characterVariantCatalog?: unknown;
  readonly catalog?: unknown;
  /** Legacy input aliases retained for callers and logs; never used to resolve a variant. */
  readonly characterVariantMapping?: unknown;
  readonly mapping?: unknown;
  readonly characterCatalogVersion?: unknown;
  /**
   * Legacy compatibility metadata. It is retained for cache and run-log
   * callers, but explicit project references now determine every variant.
   */
  readonly characterMappingVersion?: unknown;
  /** Validated ScreenTemplate catalog snapshot supplied by the application boundary. */
  readonly screenTemplateCatalogSnapshot?: unknown;
  /** Compatibility aliases used by callers while the snapshot boundary was introduced. */
  readonly screenTemplateSnapshot?: unknown;
  readonly screenTemplates?: unknown;
  /** Validated InsertTextTemplate catalog snapshot supplied by the application boundary. */
  readonly insertTextTemplateCatalogSnapshot?: unknown;
  /** Compatibility aliases for the InsertTextTemplate snapshot boundary. */
  readonly insertTextTemplateSnapshot?: unknown;
  readonly insertTextTemplates?: unknown;
};

type RenderManifestCompileOptions = {
  readonly resolveEditVideoTiming?: boolean;
};

export type RenderManifestCompileSuccess<TManifest = RenderManifest> = {
  readonly success: true;
  readonly ok: true;
  readonly manifest: TManifest;
  readonly diagnostics: readonly [];
  readonly errors: readonly [];
  readonly warnings: readonly RenderManifestWarning[];
};

export type RenderManifestCompileFailure = {
  readonly success: false;
  readonly ok: false;
  readonly manifest: null;
  readonly diagnostics: readonly RenderManifestDiagnostic[];
  readonly errors: readonly RenderManifestDiagnostic[];
  readonly warnings: readonly RenderManifestWarning[];
};

export type RenderManifestCompileResult<TManifest = RenderManifest> =
  RenderManifestCompileSuccess<TManifest> | RenderManifestCompileFailure;

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type DiagnosticContext = {
  readonly lineId?: string;
  readonly assignmentId?: string;
  readonly sectionId?: string;
  readonly variantId?: string;
  readonly assetPath?: string;
};

type NormalizedCatalogFile = {
  readonly key: string;
  readonly destinationPath: string;
  readonly checksum?: string;
};

type NormalizedCatalogVariant = {
  readonly variantId: string;
  readonly visualId: string;
  readonly status: "active" | "inactive";
  readonly visualStatus: "active" | "inactive";
  readonly visualGlowColor: string;
  readonly renderType: CharacterVariantRenderType;
  readonly files: ReadonlyMap<string, NormalizedCatalogFile>;
  readonly inputIndex: number;
};

type AssetLookup = ReadonlyMap<string, RenderManifestAssetMetadata>;

type CatalogIndex = {
  readonly byKey: ReadonlyMap<string, NormalizedCatalogVariant>;
  readonly byId: ReadonlyMap<string, readonly NormalizedCatalogVariant[]>;
};

type LineEntry = {
  readonly sectionIndex: number;
  readonly sectionId: string;
  readonly lineIndex: number;
  readonly line: RenderProjectLine;
};

type ResolvedScreenTemplate = Readonly<{
  readonly template: ScreenTemplate;
  readonly templateId: string;
  readonly templateRevision: number;
  /** RenderManifest 2.4.0/2.5.0 frozen template identity. */
  readonly templateHash: string;
  /** Current RenderManifest template identity, including RF-01 fields. */
  readonly currentTemplateHash: string;
}>;

type ResolvedInsertTextTemplate = Readonly<{
  readonly template: InsertTextTemplate;
  readonly templateHash: string;
}>;

type RenderProjectLine = {
  readonly id: string;
  readonly speakerId: string;
  readonly spokenText: string;
  readonly subtitleText: string;
  readonly expression: "neutral" | "smile" | "explain" | "caution";
  readonly characterVariantId?: string | null;
  readonly pauseBeforeMs: number;
  readonly pauseAfterMs: number;
};

function addDiagnostic(
  diagnostics: RenderManifestDiagnostic[],
  code: RenderManifestDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  context: DiagnosticContext = {}
): void {
  diagnostics.push({ code, path: [...path], message, ...context });
}

function zodPath(path: ReadonlyArray<PropertyKey>): Array<string | number> {
  return path.filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number"
  );
}

function addZodDiagnostics(
  diagnostics: RenderManifestDiagnostic[],
  code: RenderManifestDiagnosticCode,
  error: z.ZodError,
  rootPath: ReadonlyArray<string | number> = []
): void {
  for (const issue of error.issues) {
    addDiagnostic(
      diagnostics,
      code,
      [...rootPath, ...zodPath(issue.path)],
      issue.message
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])])
    );
  }
  throw new Error("Unsupported value in canonical JSON input.");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function computeSourceProjectHash(project: unknown): string {
  const parsed = videoProjectSchema.parse(project);
  return sha256CanonicalJson(parsed);
}

export function computeCompilerInputHash(input: unknown): string {
  return sha256CanonicalJson(input);
}

function normalizeChecksum(value: string): string {
  return value.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function catalogVariantKey(visualId: string, variantId: string): string {
  return `${visualId}\u0000${variantId}`;
}

function recordInputAssets(input: RenderManifestCompilerInput): unknown {
  return input.assetMetadata ?? input.assets ?? input.materials ?? [];
}

function recordInputCatalog(input: RenderManifestCompilerInput): unknown {
  // Catalog metadata is a required runtime boundary input. The legacy seed
  // fixture is intentionally not available from this production path.
  return input.characterVariantCatalog ?? input.catalog ?? null;
}

function recordInputScreenTemplates(
  input: RenderManifestCompilerInput
): unknown {
  return (
    input.screenTemplateCatalogSnapshot ??
    input.screenTemplateSnapshot ??
    input.screenTemplates ??
    null
  );
}

function recordInputInsertTextTemplates(
  input: RenderManifestCompilerInput
): unknown {
  return (
    input.insertTextTemplateCatalogSnapshot ??
    input.insertTextTemplateSnapshot ??
    input.insertTextTemplates ??
    null
  );
}

/**
 * Keep the V24/V25 cache identity on the pre-RF-01 ScreenTemplate contract.
 * Template revision and content hash remain part of that contract; the
 * dialogue window's RF-01 appearance is added only by the V26 wrapper.
 */
function screenTemplateElementForV24Hash(
  element: ScreenTemplate["elements"][number]
): unknown {
  if (element.type !== "dialogue-window") {
    return element;
  }
  const {
    backgroundColor: _backgroundColor,
    backgroundOpacity: _backgroundOpacity,
    ...legacyElement
  } = element;
  void _backgroundColor;
  void _backgroundOpacity;
  return legacyElement;
}

function screenTemplateElementsForV24Hash(
  elements: ScreenTemplate["elements"]
): unknown[] {
  return elements.map(screenTemplateElementForV24Hash);
}

function screenTemplateDiagnosticCode(
  message: string
): RenderManifestDiagnosticCode {
  if (/text|line height|overflows/.test(message)) {
    return RENDER_MANIFEST_ERROR_CODE.screenTemplateTextOverflow;
  }
  if (/exactly|speaker|unique/.test(message)) {
    return RENDER_MANIFEST_ERROR_CODE.screenTemplateCardinalityInvalid;
  }
  if (/rect|canvas|rotation|x \+|y \+|width|height/.test(message)) {
    return RENDER_MANIFEST_ERROR_CODE.screenTemplateGeometryInvalid;
  }
  return RENDER_MANIFEST_ERROR_CODE.screenTemplateSchema;
}

function normalizeScreenTemplates(
  rawTemplates: unknown,
  diagnostics: RenderManifestDiagnostic[]
): Map<string, ResolvedScreenTemplate> {
  if (rawTemplates === null || rawTemplates === undefined) {
    return new Map();
  }

  if (!Array.isArray(rawTemplates)) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.screenTemplateSchema,
      ["screenTemplateCatalogSnapshot"],
      "screen template snapshot must be an array"
    );
    return new Map();
  }

  const templates = new Map<string, ResolvedScreenTemplate>();
  for (const [index, rawTemplate] of rawTemplates.entries()) {
    const templateResult = screenTemplateSchema.safeParse(rawTemplate);
    if (!templateResult.success) {
      for (const issue of templateResult.error.issues) {
        addDiagnostic(
          diagnostics,
          screenTemplateDiagnosticCode(issue.message),
          ["screenTemplateCatalogSnapshot", index, ...zodPath(issue.path)],
          issue.message
        );
      }
      continue;
    }
    const template = templateResult.data;
    if (templates.has(template.templateId)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.screenTemplateSchema,
        ["screenTemplateCatalogSnapshot", index, "templateId"],
        "templateId must be unique in the ScreenTemplate snapshot"
      );
      continue;
    }
    const report = screenTemplateValidationReport(template);
    for (const issue of report.errors) {
      addDiagnostic(
        diagnostics,
        screenTemplateDiagnosticCode(issue.message),
        ["screenTemplateCatalogSnapshot", index, ...issue.path],
        issue.message,
        { sectionId: template.templateId }
      );
    }
    if (report.errors.length > 0) {
      continue;
    }
    templates.set(template.templateId, {
      template,
      templateId: template.templateId,
      templateRevision: template.revision,
      templateHash: screenTemplateLegacyContentHash(template),
      currentTemplateHash: screenTemplateContentHash(template)
    });
  }
  return templates;
}

function normalizeInsertTextTemplates(
  rawTemplates: unknown,
  diagnostics: RenderManifestDiagnostic[]
): Map<string, ResolvedInsertTextTemplate> {
  if (rawTemplates === null || rawTemplates === undefined) {
    return new Map();
  }
  if (!Array.isArray(rawTemplates)) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.insertTextTemplateSchema,
      ["insertTextTemplateCatalogSnapshot"],
      "insert text template snapshot must be an array"
    );
    return new Map();
  }

  const templates = new Map<string, ResolvedInsertTextTemplate>();
  for (const [index, rawTemplate] of rawTemplates.entries()) {
    const result = insertTextTemplateSchema.safeParse(rawTemplate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.insertTextTemplateSchema,
          ["insertTextTemplateCatalogSnapshot", index, ...zodPath(issue.path)],
          issue.message
        );
      }
      continue;
    }
    const template = result.data;
    if (templates.has(template.templateId)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.insertTextTemplateSchema,
        ["insertTextTemplateCatalogSnapshot", index, "templateId"],
        "templateId must be unique in the InsertTextTemplate snapshot"
      );
      continue;
    }
    templates.set(template.templateId, {
      template,
      templateHash: insertTextTemplateContentHash(template)
    });
  }
  return templates;
}

function normalizeCatalog(
  rawCatalog: unknown,
  diagnostics: RenderManifestDiagnostic[]
): NormalizedCatalogVariant[] {
  if (!Array.isArray(rawCatalog)) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.catalogSchema,
      ["characterVariantCatalog"],
      "characterVariantCatalog must be an array"
    );
    return [];
  }

  const snapshotResult =
    characterVisualCatalogSnapshotSchema.safeParse(rawCatalog);
  const catalogEntries: readonly unknown[] = snapshotResult.success
    ? snapshotResult.data.flatMap((visual) =>
        visual.variants.map((variant) => ({
          variantId: variant.variantId,
          visualId: visual.visualId,
          renderType: variant.renderType,
          status: variant.status,
          visualStatus: visual.status,
          visualGlowColor: visual.glowColor,
          files: variant.files.map((file) => ({
            key: file.key,
            destinationPath: file.libraryPath,
            checksum: file.checksum
          }))
        }))
      )
    : rawCatalog;

  const variants: NormalizedCatalogVariant[] = [];
  const variantKeys = new Set<string>();

  for (const [index, rawVariant] of catalogEntries.entries()) {
    if (!isPlainRecord(rawVariant)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index],
        "character variant must be an object"
      );
      continue;
    }

    const variantId = rawVariant.variantId;
    const visualId = rawVariant.visualId ?? rawVariant.characterId;
    const visualGlowColor =
      rawVariant.visualGlowColor ??
      rawVariant.glowColor ??
      DEFAULT_CHARACTER_VISUAL_GLOW_COLOR;
    const renderType = rawVariant.renderType;
    const status = rawVariant.status ?? "active";
    const visualStatus = rawVariant.visualStatus ?? "active";
    if (
      typeof variantId !== "string" ||
      !idSchema.safeParse(variantId).success
    ) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "variantId"],
        "variantId must be a lower-kebab-case identifier"
      );
      continue;
    }
    if (typeof visualId !== "string" || !idSchema.safeParse(visualId).success) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "visualId"],
        "visualId must be a lower-kebab-case identifier",
        { variantId }
      );
      continue;
    }
    const variantKey = catalogVariantKey(visualId, variantId);
    if (variantKeys.has(variantKey)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "variantId"],
        "variantId must be unique within a visual",
        { variantId }
      );
    }
    variantKeys.add(variantKey);

    if (status !== "active" && status !== "inactive") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "status"],
        "status must be active or inactive",
        { variantId }
      );
    }
    if (visualStatus !== "active" && visualStatus !== "inactive") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "visualStatus"],
        "visualStatus must be active or inactive",
        { variantId }
      );
    }

    if (renderType !== "single-image" && renderType !== "mouth-pair") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "renderType"],
        "renderType must be single-image or mouth-pair",
        { variantId, sectionId: visualId }
      );
      continue;
    }

    if (!Array.isArray(rawVariant.files)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "files"],
        "files must be an array",
        { variantId }
      );
      continue;
    }

    const files = new Map<string, NormalizedCatalogFile>();
    for (const [fileIndex, rawFile] of rawVariant.files.entries()) {
      if (!isPlainRecord(rawFile)) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.catalogSchema,
          ["characterVariantCatalog", index, "files", fileIndex],
          "character variant file must be an object",
          { variantId }
        );
        continue;
      }
      const key = rawFile.key;
      const destinationPath = rawFile.destinationPath;
      const rawChecksum = rawFile.checksum;
      if (typeof key !== "string" || key.length === 0) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.catalogSchema,
          ["characterVariantCatalog", index, "files", fileIndex, "key"],
          "character variant file key must be non-empty",
          { variantId }
        );
        continue;
      }
      if (files.has(key)) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.catalogSchema,
          ["characterVariantCatalog", index, "files", fileIndex, "key"],
          "character variant file keys must be unique",
          { variantId }
        );
      }
      if (
        typeof destinationPath !== "string" ||
        !relativePosixPathSchema.safeParse(destinationPath).success
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.catalogSchema,
          [
            "characterVariantCatalog",
            index,
            "files",
            fileIndex,
            "destinationPath"
          ],
          "destinationPath must be a safe relative POSIX path",
          {
            variantId,
            assetPath:
              typeof destinationPath === "string" ? destinationPath : undefined
          }
        );
        continue;
      }
      let checksum: string | undefined;
      if (rawChecksum !== undefined) {
        if (
          typeof rawChecksum !== "string" ||
          !sha256Schema.safeParse(rawChecksum).success
        ) {
          addDiagnostic(
            diagnostics,
            RENDER_MANIFEST_ERROR_CODE.catalogSchema,
            ["characterVariantCatalog", index, "files", fileIndex, "checksum"],
            "checksum must be a SHA-256 hex string",
            { variantId, assetPath: destinationPath }
          );
          continue;
        }
        checksum = normalizeChecksum(rawChecksum);
      }
      files.set(
        key,
        checksum === undefined
          ? { key, destinationPath }
          : { key, destinationPath, checksum }
      );
    }

    const expectedKeys =
      renderType === "single-image" ? ["single"] : ["closed", "open"];
    for (const key of expectedKeys) {
      if (!files.has(key)) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.variantFileSlotMissing,
          ["characterVariantCatalog", index, "files", key],
          `character variant requires the ${key} file slot`,
          { variantId }
        );
      }
    }
    for (const key of files.keys()) {
      if (!expectedKeys.includes(key)) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.catalogSchema,
          ["characterVariantCatalog", index, "files", key],
          `character variant does not support the ${key} file slot`,
          { variantId }
        );
      }
    }

    variants.push({
      variantId,
      visualId,
      status: status === "inactive" ? "inactive" : "active",
      visualStatus: visualStatus === "inactive" ? "inactive" : "active",
      visualGlowColor:
        typeof visualGlowColor === "string"
          ? visualGlowColor
          : DEFAULT_CHARACTER_VISUAL_GLOW_COLOR,
      renderType,
      files,
      inputIndex: index
    });
  }

  return variants;
}

function normalizeAssets(
  rawAssets: unknown,
  diagnostics: RenderManifestDiagnostic[]
): RenderManifestAssetMetadata[] {
  if (!Array.isArray(rawAssets)) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.assetMetadataSchema,
      ["assetMetadata"],
      "asset metadata must be an array"
    );
    return [];
  }

  const assets: RenderManifestAssetMetadata[] = [];
  const paths = new Set<string>();
  for (const [index, rawAsset] of rawAssets.entries()) {
    const result = renderManifestAssetMetadataSchema.safeParse(rawAsset);
    if (!result.success) {
      addZodDiagnostics(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.assetMetadataSchema,
        result.error,
        ["assetMetadata", index]
      );
      continue;
    }
    if (paths.has(result.data.path)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.assetMetadataSchema,
        ["assetMetadata", index, "path"],
        "asset metadata path must be unique",
        { assetPath: result.data.path }
      );
    }
    paths.add(result.data.path);
    assets.push(result.data);
  }
  return assets;
}

function validateVersion(
  value: unknown,
  defaultValue: string,
  code: RenderManifestDiagnosticCode,
  path: string,
  diagnostics: RenderManifestDiagnostic[]
): string {
  if (typeof value === "undefined") {
    return defaultValue;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  addDiagnostic(
    diagnostics,
    code,
    [path],
    "version must be a non-empty string"
  );
  return defaultValue;
}

function getAssetLookup(
  assets: readonly RenderManifestAssetMetadata[]
): AssetLookup {
  return new Map(assets.map((asset) => [asset.path, asset]));
}

function requireAsset(
  lookup: AssetLookup,
  pathValue: string,
  expectedKinds: readonly string[],
  diagnostics: RenderManifestDiagnostic[],
  path: ReadonlyArray<string | number>,
  context: DiagnosticContext,
  expectedSha256?: string,
  requireDuration = false,
  checksumCode: RenderManifestDiagnosticCode = RENDER_MANIFEST_ERROR_CODE.assetChecksumMismatch
): RenderManifestAssetMetadata | undefined {
  const asset = lookup.get(pathValue);
  if (asset === undefined) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.assetMissing,
      path,
      "referenced asset metadata was not provided",
      { ...context, assetPath: pathValue }
    );
    return undefined;
  }
  if (!expectedKinds.includes(asset.kind)) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.assetKindMismatch,
      path,
      `asset kind must be one of: ${expectedKinds.join(", ")}`,
      { ...context, assetPath: pathValue }
    );
  }
  if (
    expectedSha256 !== undefined &&
    normalizeChecksum(asset.sha256) !== normalizeChecksum(expectedSha256)
  ) {
    addDiagnostic(
      diagnostics,
      checksumCode,
      path,
      "asset checksum does not match the expected reference",
      { ...context, assetPath: pathValue }
    );
  }
  if (requireDuration) {
    if (asset.durationMs === undefined || asset.durationMs === null) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.assetDurationMissing,
        path,
        "asset durationMs is required",
        { ...context, assetPath: pathValue }
      );
    } else if (asset.durationMs <= 0) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.assetDurationInvalid,
        path,
        "asset durationMs must be positive",
        { ...context, assetPath: pathValue }
      );
    }
  }
  return asset;
}

function validateEditAssetFormat(
  asset: RenderManifestAssetMetadata,
  expected: "video" | "bgm",
  diagnostics: RenderManifestDiagnostic[],
  path: ReadonlyArray<string | number>,
  context: DiagnosticContext
): void {
  const extension = asset.path.toLowerCase().split(".").pop();
  const expectedExtension = expected === "video" ? "mp4" : "mp3";
  const expectedMimeType = expected === "video" ? "video/mp4" : "audio/mpeg";
  const rawMimeType = asset.mimeType;
  const mimeType = typeof rawMimeType === "string" ? rawMimeType : undefined;
  const rawFormat = asset.format;
  const format = typeof rawFormat === "string" ? rawFormat : undefined;
  if (
    extension !== expectedExtension ||
    mimeType !== expectedMimeType ||
    format !== expectedExtension
  ) {
    addDiagnostic(
      diagnostics,
      expected === "video"
        ? RENDER_MANIFEST_ERROR_CODE.editVideoFormatInvalid
        : RENDER_MANIFEST_ERROR_CODE.editBgmFormatInvalid,
      path,
      `edit ${expected} asset must be a supported ${expectedExtension.toUpperCase()} file`,
      context
    );
  }
}

function addSourceAsset(
  sourceAssets: Map<string, string>,
  asset: RenderManifestAssetMetadata,
  diagnostics: RenderManifestDiagnostic[],
  context: DiagnosticContext
): void {
  const checksum = normalizeChecksum(asset.sha256);
  const previous = sourceAssets.get(asset.path);
  if (previous !== undefined && previous !== checksum) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.assetChecksumMismatch,
      ["sourceAssetChecksums", asset.path],
      "the same referenced asset has conflicting checksums",
      { ...context, assetPath: asset.path }
    );
    return;
  }
  sourceAssets.set(asset.path, checksum);
}

function expectedCharacterKinds(kind: string): boolean {
  return kind === "character" || kind === "image" || kind === "photo";
}

function variantForId(
  catalog: CatalogIndex,
  variantId: string,
  visualId: string,
  diagnostics: RenderManifestDiagnostic[],
  context: DiagnosticContext
): NormalizedCatalogVariant | undefined {
  let variant = catalog.byKey.get(catalogVariantKey(visualId, variantId));
  if (variant === undefined) {
    const variantsWithId = catalog.byId.get(variantId);
    if (variantsWithId !== undefined && variantsWithId.length > 0) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.variantCharacterMismatch,
        ["characterVariantCatalog", variantId, "visualId"],
        "explicit character variant belongs to a different visual",
        { ...context, variantId }
      );
      variant = variantsWithId[0];
    } else {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.variantMissing,
        ["characterVariantCatalog", variantId],
        "explicit character variant is not present in characterVariantCatalog",
        { ...context, variantId }
      );
      return undefined;
    }
  }
  if (variant.visualStatus !== "active") {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.characterVisualInactive,
      ["characterVariantCatalog", variant.inputIndex, "visualStatus"],
      "the referenced character visual is inactive",
      { ...context, variantId }
    );
  }
  if (variant.status !== "active") {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.characterVariantInactive,
      ["characterVariantCatalog", variant.inputIndex, "status"],
      "the referenced character variant is inactive",
      { ...context, variantId }
    );
  }
  return variant;
}

function shiftedFrom(
  from: number,
  sectionId: string,
  sectionShiftById: ReadonlyMap<string, number>
): number {
  const shift = sectionShiftById.get(sectionId);
  if (shift === undefined) {
    throw new Error(`section shift is missing: ${sectionId}`);
  }
  return from + shift;
}

function stableTimelineSort<T extends { readonly from: number }>(
  entries: readonly { readonly value: T; readonly inputIndex: number }[]
): T[] {
  return [...entries]
    .sort((left, right) => {
      const fromDifference = left.value.from - right.value.from;
      return fromDifference === 0
        ? left.inputIndex - right.inputIndex
        : fromDifference;
    })
    .map(({ value }) => value);
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/**
 * Detect continuous half-open intervals where at least three sound effects are
 * active. Adjacent intervals are merged so a warning is emitted per usable
 * overlap region rather than once per frame.
 */
export function detectSoundEffectWarnings(
  effects: readonly Pick<
    RenderSoundEffect,
    "id" | "lineId" | "from" | "durationInFrames"
  >[]
): RenderManifestWarning[] {
  const boundaries = [
    ...new Set(
      effects.flatMap((effect) => [
        effect.from,
        effect.from + effect.durationInFrames
      ])
    )
  ].sort((left, right) => left - right);
  const warnings: RenderManifestWarning[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    if (from === undefined || to === undefined || from >= to) {
      continue;
    }
    const activeEffects = effects.filter(
      (effect) =>
        effect.from <= from && from < effect.from + effect.durationInFrames
    );
    if (activeEffects.length < 3) {
      continue;
    }

    const soundEffectIds = sortedUniqueStrings(
      activeEffects.map((effect) => effect.id)
    );
    const lineIds = sortedUniqueStrings(
      activeEffects.map((effect) => effect.lineId)
    );
    const previous = warnings[warnings.length - 1];
    if (previous?.to === from) {
      warnings[warnings.length - 1] = {
        ...previous,
        to,
        soundEffectIds: sortedUniqueStrings([
          ...previous.soundEffectIds,
          ...soundEffectIds
        ]),
        lineIds: sortedUniqueStrings([...previous.lineIds, ...lineIds])
      };
      continue;
    }

    warnings.push({
      code: RENDER_MANIFEST_WARNING_CODE.soundEffectOverlap,
      message: "three or more sound effects overlap in this interval",
      from,
      to,
      soundEffectIds,
      lineIds
    });
  }

  return warnings;
}

function resolvedLayoutForTemplate(
  binding: ResolvedScreenTemplate,
  characters: readonly { readonly id: string }[],
  prioritizeVisual: boolean
): ResolvedScreenLayout {
  return resolveScreenTemplateLayout(binding.template, {
    characterIds: {
      "speaker-1": characters[0]?.id,
      "speaker-2": characters[1]?.id
    },
    prioritizeVisual
  });
}

function linePrioritySet(
  project: z.infer<typeof videoProjectSchema>,
  lineEntries: readonly LineEntry[]
): Set<string> {
  const entryById = new Map(lineEntries.map((entry) => [entry.line.id, entry]));
  const priority = new Set<string>();
  for (const assignment of project.visuals.assignments) {
    if (!assignment.display.prioritizeVisual) {
      continue;
    }
    const start = entryById.get(assignment.startLineId);
    const end = entryById.get(assignment.endLineId);
    if (
      start === undefined ||
      end === undefined ||
      start.sectionId !== end.sectionId
    ) {
      continue;
    }
    for (const entry of lineEntries) {
      if (
        entry.sectionId === start.sectionId &&
        entry.lineIndex >= start.lineIndex &&
        entry.lineIndex <= end.lineIndex
      ) {
        priority.add(entry.line.id);
      }
    }
  }
  return priority;
}

function visualSegmentId(
  sourceAssignmentId: string,
  segmentStartLineId: string,
  segmentEndLineId: string,
  binding: ResolvedScreenTemplate
): string {
  return `visual-${sha256CanonicalJson({
    sourceAssignmentId,
    segmentStartLineId,
    segmentEndLineId,
    screenTemplateId: binding.templateId,
    templateRevision: binding.templateRevision,
    templateHash: binding.templateHash
  })}`;
}

function elapsedMediaMs(
  frames: number,
  fps: number,
  playbackRate: number
): number {
  return Math.round((frames * 1000 * playbackRate) / fps);
}

type VisualSegmentBuildInput = Readonly<{
  readonly project: z.infer<typeof videoProjectSchema>;
  readonly lineEntries: readonly LineEntry[];
  readonly lineRangeById: ReadonlyMap<string, TimelineLineRange>;
  readonly lineIndexById: ReadonlyMap<string, LineEntry>;
  readonly visualRanges: readonly {
    readonly id: string;
    readonly from: number;
    readonly durationInFrames: number;
  }[];
  readonly sectionShiftById: ReadonlyMap<string, number>;
  readonly templates: ReadonlyMap<string, ResolvedScreenTemplate>;
  readonly characters: readonly { readonly id: string }[];
  readonly fps: number;
  readonly diagnostics: RenderManifestDiagnostic[];
}>;

function buildVisualSegments({
  project,
  lineEntries,
  lineRangeById,
  lineIndexById,
  visualRanges,
  sectionShiftById,
  templates,
  characters,
  fps,
  diagnostics
}: VisualSegmentBuildInput): RenderVisualV24[] {
  const assignmentById = new Map(
    project.visuals.assignments.map((assignment) => [assignment.id, assignment])
  );
  const segments: Array<{ value: RenderVisualV24; inputIndex: number }> = [];

  for (const [assignmentIndex, range] of visualRanges.entries()) {
    const assignment = assignmentById.get(range.id);
    if (assignment === undefined) {
      continue;
    }
    const start = lineIndexById.get(assignment.startLineId);
    const end = lineIndexById.get(assignment.endLineId);
    if (
      start === undefined ||
      end === undefined ||
      start.sectionId !== end.sectionId
    ) {
      continue;
    }
    const assignmentSectionId = start.sectionId;
    const assignmentFrom = shiftedFrom(
      range.from,
      assignmentSectionId,
      sectionShiftById
    );
    const assignmentLines = lineEntries.filter(
      (entry) =>
        entry.sectionId === assignmentSectionId &&
        entry.lineIndex >= start.lineIndex &&
        entry.lineIndex <= end.lineIndex
    );
    const first = assignmentLines[0];
    if (first === undefined) {
      continue;
    }
    const firstTemplateId =
      project.script.sections[first.sectionIndex]?.screenTemplateId;
    const firstBinding =
      firstTemplateId === undefined
        ? undefined
        : templates.get(firstTemplateId);
    if (firstBinding === undefined) {
      continue;
    }
    const last = assignmentLines.at(-1);
    const firstRange = lineRangeById.get(first.line.id);
    const lastRange =
      last === undefined ? undefined : lineRangeById.get(last.line.id);
    if (
      last === undefined ||
      firstRange === undefined ||
      lastRange === undefined
    ) {
      continue;
    }
    const segmentIndex = 0;
    const baseFrom = firstRange.from;
    const baseTo = lastRange.from + lastRange.durationInFrames;
    const from = shiftedFrom(baseFrom, assignmentSectionId, sectionShiftById);
    const durationInFrames = baseTo - baseFrom;
    const templateLayout = resolvedLayoutForTemplate(
      firstBinding,
      characters,
      false
    );
    const sourceDisplay = assignment.display;
    let videoSegmentTrim:
      | {
          readonly sourceTrimBeforeFrame: number;
          readonly sourceTrimAfterFrame: number;
        }
      | undefined;
    if (sourceDisplay.kind === "video") {
      const sourceStartFrame = mediaMillisecondsToFrames(
        sourceDisplay.startMs,
        fps
      );
      const elapsedStartFrames = from - assignmentFrom;
      const elapsedEndFrames = from + durationInFrames - assignmentFrom;
      const sourceTrimBeforeFrame =
        sourceStartFrame +
        presentationFramesToMediaPosition(
          elapsedStartFrames,
          sourceDisplay.playbackRate
        );
      const legacyEndMs = Math.min(
        sourceDisplay.endMs,
        sourceDisplay.startMs +
          elapsedMediaMs(elapsedEndFrames, fps, sourceDisplay.playbackRate)
      );
      const sourceTrimAfterFrame =
        legacyEndMs < sourceDisplay.endMs
          ? sourceStartFrame +
            presentationFramesToMediaPosition(
              elapsedEndFrames,
              sourceDisplay.playbackRate
            )
          : mediaMillisecondsToFrames(legacyEndMs, fps);
      videoSegmentTrim = {
        sourceTrimBeforeFrame,
        sourceTrimAfterFrame
      };
    }

    const display = resolveVisualDisplay(sourceDisplay, templateLayout, {
      fps,
      sourceTrimBeforeFrame: videoSegmentTrim?.sourceTrimBeforeFrame,
      sourceTrimAfterFrame: videoSegmentTrim?.sourceTrimAfterFrame
    });

    if (videoSegmentTrim && display.kind === "video") {
      const { sourceTrimBeforeFrame, sourceTrimAfterFrame } = videoSegmentTrim;
      if (sourceTrimAfterFrame <= sourceTrimBeforeFrame) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.visualSegmentRangeInvalid,
          ["visuals", "assignments", assignmentIndex, "display"],
          "resolved video segment source range must be positive and within the assignment source range",
          {
            assignmentId: assignment.id,
            assetPath: assignment.projectMediaPath
          }
        );
      }
    }

    const segmentStartLineId = first.line.id;
    const segmentEndLineId = last.line.id;
    segments.push({
      inputIndex: assignmentIndex * 1000 + segmentIndex,
      value: {
        id: visualSegmentId(
          assignment.id,
          segmentStartLineId,
          segmentEndLineId,
          firstBinding
        ),
        sourceAssignmentId: assignment.id,
        segmentIndex,
        segmentStartLineId,
        segmentEndLineId,
        screenTemplateId: firstBinding.templateId,
        templateRevision: firstBinding.templateRevision,
        templateHash: firstBinding.templateHash,
        from,
        durationInFrames,
        kind: assignment.display.kind,
        src: assignment.projectMediaPath,
        display
      } as RenderVisualV24
    });
  }

  return stableTimelineSort(segments);
}

function orderedScreenTransform(
  transform: ResolvedScreenLayout["elements"][number]["transform"]
): ResolvedScreenLayout["elements"][number]["transform"] {
  return {
    rect: {
      x: transform.rect.x,
      y: transform.rect.y,
      width: transform.rect.width,
      height: transform.rect.height
    },
    rotationDeg: transform.rotationDeg
  };
}

function orderedResolvedLayout(
  layout: ResolvedScreenLayout
): ResolvedScreenLayout {
  return {
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    elements: layout.elements.map((element) => {
      if (element.type === "dialogue-window") {
        return {
          elementId: element.elementId,
          type: element.type,
          transform: orderedScreenTransform(element.transform),
          fontSize: element.fontSize
        };
      }
      if (element.type === "section-title") {
        return {
          elementId: element.elementId,
          type: element.type,
          transform: orderedScreenTransform(element.transform),
          fontSize: element.fontSize
        };
      }
      if (element.type === "content-slot") {
        return {
          elementId: element.elementId,
          type: element.type,
          slot: element.slot,
          transform: orderedScreenTransform(element.transform)
        };
      }
      return {
        elementId: element.elementId,
        type: element.type,
        slot: element.slot,
        characterId: element.characterId,
        transform: orderedScreenTransform(element.transform),
        flipX: element.flipX
      };
    })
  };
}

function orderedResolvedLayoutV26(
  layout: ResolvedScreenLayoutV26
): ResolvedScreenLayoutV26 {
  return {
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    elements: layout.elements.map((element): ResolvedScreenElementV26 => {
      if (element.type === "dialogue-window") {
        return {
          elementId: element.elementId,
          type: element.type,
          transform: orderedScreenTransform(element.transform),
          fontSize: element.fontSize,
          backgroundColor: element.backgroundColor,
          backgroundOpacity: element.backgroundOpacity
        };
      }
      if (element.type === "section-title") {
        return {
          elementId: element.elementId,
          type: element.type,
          transform: orderedScreenTransform(element.transform),
          fontSize: element.fontSize
        };
      }
      if (element.type === "content-slot") {
        return {
          elementId: element.elementId,
          type: element.type,
          slot: element.slot,
          transform: orderedScreenTransform(element.transform)
        };
      }
      return {
        elementId: element.elementId,
        type: element.type,
        slot: element.slot,
        characterId: element.characterId,
        transform: orderedScreenTransform(element.transform),
        flipX: element.flipX
      };
    })
  };
}

function orderedResolvedDisplay(
  display: RenderResolvedVisualDisplay
): RenderResolvedVisualDisplay {
  if (display.kind === "video") {
    return {
      kind: display.kind,
      outerFrame: orderedScreenTransform(display.outerFrame),
      contentClip: {
        transform: orderedScreenTransform(display.contentClip.transform),
        enabled: display.contentClip.enabled
      },
      fit: display.fit,
      crop: display.crop,
      annotations: display.annotations,
      startMs: display.startMs,
      endMs: display.endMs,
      sourceTrimBeforeFrame: display.sourceTrimBeforeFrame,
      sourceTrimAfterFrame: display.sourceTrimAfterFrame,
      playbackRate: display.playbackRate,
      volume: display.volume
    };
  }
  if (display.kind === "photo") {
    return {
      kind: display.kind,
      outerFrame: orderedScreenTransform(display.outerFrame),
      contentClip: {
        transform: orderedScreenTransform(display.contentClip.transform),
        enabled: display.contentClip.enabled
      },
      fit: display.fit,
      crop: display.crop,
      annotations: display.annotations
    };
  }
  return {
    kind: display.kind,
    outerFrame: orderedScreenTransform(display.outerFrame),
    contentClip: {
      transform: orderedScreenTransform(display.contentClip.transform),
      enabled: display.contentClip.enabled
    },
    fit: display.fit,
    crop: display.crop,
    annotations: display.annotations,
    page: display.page
  };
}

function orderedBackground(
  background: RenderBackground["background"]
): RenderBackground["background"] {
  if (background.kind === "solid") {
    return { kind: background.kind, colorToken: background.colorToken };
  }
  return {
    kind: background.kind,
    src: background.src,
    fit: background.fit
  };
}

function orderedManifestV24(manifest: RenderManifestV24): RenderManifestV24 {
  return {
    manifestVersion: manifest.manifestVersion,
    sourceProjectHash: manifest.sourceProjectHash,
    compilerInputHash: manifest.compilerInputHash,
    characterCatalogVersion: manifest.characterCatalogVersion,
    characterMappingVersion: manifest.characterMappingVersion,
    characters: manifest.characters.map((character): RenderCharacter => ({
      characterId: character.characterId,
      visualId: character.visualId,
      displayName: character.displayName,
      themeColorToken: character.themeColorToken,
      lipSyncPeriodFrames: character.lipSyncPeriodFrames,
      idleVariantId: character.idleVariantId
    })),
    characterVariants: manifest.characterVariants.map(
      (variant): RenderCharacterVariant =>
        variant.renderType === "single-image"
          ? {
              variantId: variant.variantId,
              visualId: variant.visualId,
              renderType: variant.renderType,
              files: {
                single: {
                  path: variant.files.single.path,
                  sha256: variant.files.single.sha256
                }
              }
            }
          : {
              variantId: variant.variantId,
              visualId: variant.visualId,
              renderType: variant.renderType,
              files: {
                closed: {
                  path: variant.files.closed.path,
                  sha256: variant.files.closed.sha256
                },
                open: {
                  path: variant.files.open.path,
                  sha256: variant.files.open.sha256
                }
              }
            }
    ),
    sourceAssetChecksums: manifest.sourceAssetChecksums.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256
    })),
    fps: manifest.fps,
    width: manifest.width,
    height: manifest.height,
    durationInFrames: manifest.durationInFrames,
    sectionLayouts: manifest.sectionLayouts.map(
      (layout): RenderSectionLayout => ({
        sectionId: layout.sectionId,
        sectionTitle: layout.sectionTitle,
        templateId: layout.templateId,
        templateRevision: layout.templateRevision,
        templateHash: layout.templateHash,
        resolvedLayout: orderedResolvedLayout(layout.resolvedLayout)
      })
    ),
    lines: manifest.lines.map((line): RenderLineV24 => ({
      id: line.id,
      sectionId: line.sectionId,
      from: line.from,
      durationInFrames: line.durationInFrames,
      speechFrom: line.speechFrom,
      speechDurationInFrames: line.speechDurationInFrames,
      audioPath: line.audioPath,
      subtitleText: line.subtitleText,
      speakerId: line.speakerId,
      expression: line.expression,
      characterVariantId: line.characterVariantId,
      screenTemplateId: line.screenTemplateId,
      templateRevision: line.templateRevision,
      templateHash: line.templateHash,
      resolvedLayout: orderedResolvedLayout(line.resolvedLayout)
    })),
    visuals: manifest.visuals.map((visual): RenderVisualV24 => {
      if (visual.kind === "video") {
        return {
          id: visual.id,
          sourceAssignmentId: visual.sourceAssignmentId,
          segmentIndex: visual.segmentIndex,
          segmentStartLineId: visual.segmentStartLineId,
          segmentEndLineId: visual.segmentEndLineId,
          screenTemplateId: visual.screenTemplateId,
          templateRevision: visual.templateRevision,
          templateHash: visual.templateHash,
          from: visual.from,
          durationInFrames: visual.durationInFrames,
          src: visual.src,
          kind: visual.kind,
          display: orderedResolvedDisplay(visual.display) as Extract<
            RenderVisualV24,
            { kind: "video" }
          >["display"]
        };
      }
      if (visual.kind === "photo") {
        return {
          id: visual.id,
          sourceAssignmentId: visual.sourceAssignmentId,
          segmentIndex: visual.segmentIndex,
          segmentStartLineId: visual.segmentStartLineId,
          segmentEndLineId: visual.segmentEndLineId,
          screenTemplateId: visual.screenTemplateId,
          templateRevision: visual.templateRevision,
          templateHash: visual.templateHash,
          from: visual.from,
          durationInFrames: visual.durationInFrames,
          src: visual.src,
          kind: visual.kind,
          display: orderedResolvedDisplay(visual.display) as Extract<
            RenderVisualV24,
            { kind: "photo" }
          >["display"]
        };
      }
      return {
        id: visual.id,
        sourceAssignmentId: visual.sourceAssignmentId,
        segmentIndex: visual.segmentIndex,
        segmentStartLineId: visual.segmentStartLineId,
        segmentEndLineId: visual.segmentEndLineId,
        screenTemplateId: visual.screenTemplateId,
        templateRevision: visual.templateRevision,
        templateHash: visual.templateHash,
        from: visual.from,
        durationInFrames: visual.durationInFrames,
        src: visual.src,
        kind: visual.kind,
        display: orderedResolvedDisplay(visual.display) as Extract<
          RenderVisualV24,
          { kind: "document_scan" }
        >["display"]
      };
    }),
    backgrounds: manifest.backgrounds.map((background): RenderBackground => ({
      sectionId: background.sectionId,
      from: background.from,
      durationInFrames: background.durationInFrames,
      background: orderedBackground(background.background)
    })),
    audioTracks: manifest.audioTracks.map((track) => ({
      id: track.id,
      sectionId: track.sectionId,
      from: track.from,
      durationInFrames: track.durationInFrames,
      src: track.src,
      volume: track.volume,
      loop: track.loop
    })),
    soundEffects: manifest.soundEffects.map((effect): RenderSoundEffect => ({
      id: effect.id,
      lineId: effect.lineId,
      category: effect.category,
      from: effect.from,
      durationInFrames: effect.durationInFrames,
      src: effect.src,
      volume: effect.volume
    })),
    inserts: manifest.inserts.map((insert): RenderInsert => ({
      id: insert.id,
      role: insert.role,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      src: insert.src,
      volume: insert.volume
    }))
  };
}

function orderedResolvedDisplayV25Video(
  display: RenderResolvedVideoDisplayV25
): RenderResolvedVideoDisplayV25 {
  const common = {
    kind: display.kind,
    outerFrame: orderedScreenTransform(display.outerFrame),
    contentClip: {
      transform: orderedScreenTransform(display.contentClip.transform),
      enabled: display.contentClip.enabled
    },
    fit: display.fit,
    crop: display.crop,
    annotations: display.annotations,
    startMs: display.startMs,
    endMs: display.endMs,
    playbackRate: display.playbackRate,
    volume: display.volume,
    playbackCues: display.playbackCues
  };
  if (display.playbackState === "playing") {
    return {
      ...common,
      playbackState: display.playbackState,
      sourceTrimBeforeFrame: display.sourceTrimBeforeFrame,
      sourceTrimAfterFrame: display.sourceTrimAfterFrame
    };
  }
  if (display.playbackState === "paused") {
    return {
      ...common,
      volume: 0,
      playbackState: "paused",
      sourceFrame: display.sourceFrame
    };
  }
  return {
    ...common,
    volume: 0,
    playbackState: "ended",
    sourceFrame: display.sourceFrame
  };
}

function orderedManifest(manifest: RenderManifestV25): RenderManifestV25 {
  return {
    manifestVersion: manifest.manifestVersion,
    sourceProjectHash: manifest.sourceProjectHash,
    compilerInputHash: manifest.compilerInputHash,
    characterCatalogVersion: manifest.characterCatalogVersion,
    characterMappingVersion: manifest.characterMappingVersion,
    characters: manifest.characters.map((character): RenderCharacter => ({
      characterId: character.characterId,
      visualId: character.visualId,
      displayName: character.displayName,
      themeColorToken: character.themeColorToken,
      lipSyncPeriodFrames: character.lipSyncPeriodFrames,
      idleVariantId: character.idleVariantId
    })),
    characterVariants: manifest.characterVariants.map(
      (variant): RenderCharacterVariant =>
        variant.renderType === "single-image"
          ? {
              variantId: variant.variantId,
              visualId: variant.visualId,
              renderType: variant.renderType,
              files: {
                single: {
                  path: variant.files.single.path,
                  sha256: variant.files.single.sha256
                }
              }
            }
          : {
              variantId: variant.variantId,
              visualId: variant.visualId,
              renderType: variant.renderType,
              files: {
                closed: {
                  path: variant.files.closed.path,
                  sha256: variant.files.closed.sha256
                },
                open: {
                  path: variant.files.open.path,
                  sha256: variant.files.open.sha256
                }
              }
            }
    ),
    sourceAssetChecksums: manifest.sourceAssetChecksums.map((asset) => ({
      path: asset.path,
      sha256: asset.sha256
    })),
    fps: manifest.fps,
    width: manifest.width,
    height: manifest.height,
    durationInFrames: manifest.durationInFrames,
    sectionLayouts: manifest.sectionLayouts.map(
      (layout): RenderSectionLayout => ({
        sectionId: layout.sectionId,
        sectionTitle: layout.sectionTitle,
        templateId: layout.templateId,
        templateRevision: layout.templateRevision,
        templateHash: layout.templateHash,
        resolvedLayout: orderedResolvedLayout(layout.resolvedLayout)
      })
    ),
    layoutIntervals: manifest.layoutIntervals.map(
      (interval): RenderLayoutInterval => ({
        sectionId: interval.sectionId,
        from: interval.from,
        durationInFrames: interval.durationInFrames,
        resolvedLayout: orderedResolvedLayout(interval.resolvedLayout)
      })
    ),
    lines: manifest.lines.map((line): RenderLine => ({
      id: line.id,
      sectionId: line.sectionId,
      from: line.from,
      durationInFrames: line.durationInFrames,
      speechFrom: line.speechFrom,
      speechDurationInFrames: line.speechDurationInFrames,
      audioPath: line.audioPath,
      subtitleText: line.subtitleText,
      speakerId: line.speakerId,
      expression: line.expression,
      characterVariantId: line.characterVariantId
    })),
    visuals: manifest.visuals.map((visual): RenderVisualV25 => {
      const common = {
        id: visual.id,
        sourceAssignmentId: visual.sourceAssignmentId,
        segmentIndex: visual.segmentIndex,
        segmentStartLineId: visual.segmentStartLineId,
        segmentEndLineId: visual.segmentEndLineId,
        sectionId: visual.sectionId,
        templateRevision: visual.templateRevision,
        templateHash: visual.templateHash,
        from: visual.from,
        durationInFrames: visual.durationInFrames,
        src: visual.src,
        kind: visual.kind
      };
      if (visual.kind === "video") {
        return {
          ...common,
          kind: visual.kind,
          display: orderedResolvedDisplayV25Video(visual.display)
        } as RenderVisualV25;
      }
      if (visual.kind === "photo") {
        return {
          ...common,
          kind: visual.kind,
          display: {
            kind: visual.display.kind,
            outerFrame: orderedScreenTransform(visual.display.outerFrame),
            contentClip: {
              transform: orderedScreenTransform(
                visual.display.contentClip.transform
              ),
              enabled: visual.display.contentClip.enabled
            },
            fit: visual.display.fit,
            crop: visual.display.crop,
            annotations: visual.display.annotations
          }
        } as RenderVisualV25;
      }
      return {
        ...common,
        kind: visual.kind,
        display: {
          kind: visual.display.kind,
          outerFrame: orderedScreenTransform(visual.display.outerFrame),
          contentClip: {
            transform: orderedScreenTransform(
              visual.display.contentClip.transform
            ),
            enabled: visual.display.contentClip.enabled
          },
          fit: visual.display.fit,
          crop: visual.display.crop,
          annotations: visual.display.annotations,
          page: visual.display.page
        }
      } as RenderVisualV25;
    }),
    backgrounds: manifest.backgrounds.map((background): RenderBackground => ({
      sectionId: background.sectionId,
      from: background.from,
      durationInFrames: background.durationInFrames,
      background: orderedBackground(background.background)
    })),
    audioTracks: manifest.audioTracks.map((track) => ({
      id: track.id,
      sectionId: track.sectionId,
      from: track.from,
      durationInFrames: track.durationInFrames,
      src: track.src,
      volume: track.volume,
      loop: track.loop
    })),
    soundEffects: manifest.soundEffects.map((effect): RenderSoundEffect => ({
      id: effect.id,
      lineId: effect.lineId,
      category: effect.category,
      from: effect.from,
      durationInFrames: effect.durationInFrames,
      src: effect.src,
      volume: effect.volume
    })),
    inserts: manifest.inserts.map((insert): RenderInsert => ({
      id: insert.id,
      role: insert.role,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      src: insert.src,
      volume: insert.volume
    }))
  };
}

function orderedManifestV26(manifest: RenderManifestV26): RenderManifestV26 {
  const orderedLegacy = orderedManifest(
    manifest as unknown as RenderManifestV25
  );
  return {
    ...orderedLegacy,
    manifestVersion: manifest.manifestVersion,
    characters: manifest.characters.map((character) => ({
      characterId: character.characterId,
      visualId: character.visualId,
      displayName: character.displayName,
      themeColorToken: character.themeColorToken,
      lipSyncPeriodFrames: character.lipSyncPeriodFrames,
      idleVariantId: character.idleVariantId,
      glowColor: character.glowColor
    })),
    sectionLayouts: manifest.sectionLayouts.map((layout) => ({
      sectionId: layout.sectionId,
      sectionTitle: layout.sectionTitle,
      templateId: layout.templateId,
      templateRevision: layout.templateRevision,
      templateHash: layout.templateHash,
      resolvedLayout: orderedResolvedLayoutV26(layout.resolvedLayout)
    })),
    layoutIntervals: manifest.layoutIntervals.map((interval) => ({
      sectionId: interval.sectionId,
      from: interval.from,
      durationInFrames: interval.durationInFrames,
      resolvedLayout: orderedResolvedLayoutV26(interval.resolvedLayout)
    }))
  };
}

function orderedManifestV27(manifest: RenderManifestV27): RenderManifestV27 {
  const orderedLegacy = orderedManifestV26(
    manifest as unknown as RenderManifestV26
  );
  return {
    ...orderedLegacy,
    manifestVersion: manifest.manifestVersion,
    inserts: manifest.inserts.map((insert): RenderInsertV27 => ({
      id: insert.id,
      role: insert.role,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      src: insert.src,
      volume: insert.volume,
      text:
        insert.text === null
          ? null
          : ({
              templateId: insert.text.templateId,
              templateRevision: insert.text.templateRevision,
              templateHash: insert.text.templateHash,
              text: insert.text.text,
              resolvedTextLayout: {
                rect: insert.text.resolvedTextLayout.rect,
                rotationDeg: insert.text.resolvedTextLayout.rotationDeg,
                fontSize: insert.text.resolvedTextLayout.fontSize,
                fontWeight: insert.text.resolvedTextLayout.fontWeight,
                textColor: insert.text.resolvedTextLayout.textColor,
                textAlign: insert.text.resolvedTextLayout.textAlign,
                verticalAlign: insert.text.resolvedTextLayout.verticalAlign
              }
            } satisfies RenderInsertTextSnapshot)
    }))
  };
}

function orderedManifestV28(manifest: RenderManifestV28): RenderManifestV28 {
  const orderedLegacy = orderedManifestV27(
    manifest as unknown as RenderManifestV27
  );
  return {
    ...orderedLegacy,
    manifestVersion: manifest.manifestVersion,
    inserts: manifest.inserts.map((insert): RenderInsertV28 => ({
      id: insert.id,
      role: insert.role,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      src: insert.src,
      volume: insert.volume,
      startMs: insert.startMs,
      playbackRate: insert.playbackRate,
      text:
        insert.text === null
          ? null
          : {
              templateId: insert.text.templateId,
              templateRevision: insert.text.templateRevision,
              templateHash: insert.text.templateHash,
              text: insert.text.text,
              resolvedTextLayout: {
                rect: insert.text.resolvedTextLayout.rect,
                rotationDeg: insert.text.resolvedTextLayout.rotationDeg,
                fontSize: insert.text.resolvedTextLayout.fontSize,
                fontWeight: insert.text.resolvedTextLayout.fontWeight,
                textColor: insert.text.resolvedTextLayout.textColor,
                textAlign: insert.text.resolvedTextLayout.textAlign,
                verticalAlign: insert.text.resolvedTextLayout.verticalAlign
              }
            }
    }))
  };
}

function orderedManifestV29(manifest: RenderManifestV29): RenderManifestV29 {
  const orderedLegacy = orderedManifestV28(
    manifest as unknown as RenderManifestV28
  );
  return {
    ...orderedLegacy,
    manifestVersion: manifest.manifestVersion,
    lineOverlays: manifest.lineOverlays.map(
      (overlay): RenderLineOverlay =>
        ({
          id: overlay.id,
          lineId: overlay.lineId,
          from: overlay.from,
          durationInFrames: overlay.durationInFrames,
          kind: overlay.kind,
          resolvedTransform: {
            x: overlay.resolvedTransform.x,
            y: overlay.resolvedTransform.y,
            width: overlay.resolvedTransform.width,
            height: overlay.resolvedTransform.height,
            rotationDeg: overlay.resolvedTransform.rotationDeg
          },
          colorToken: overlay.colorToken,
          text: overlay.text,
          animation: overlay.animation
        }) as RenderLineOverlay
    )
  };
}

export function serializeRenderManifest(manifest: unknown): string {
  const parsed = renderManifestSchema.parse(manifest);
  return `${JSON.stringify(orderedManifestV29(parsed), null, 2)}\n`;
}

export function serializeRenderManifestV24(manifest: unknown): string {
  const parsed = renderManifestV24Schema.parse(manifest);
  return `${JSON.stringify(orderedManifestV24(parsed), null, 2)}\n`;
}

function failure(
  diagnostics: readonly RenderManifestDiagnostic[],
  warnings: readonly RenderManifestWarning[] = []
): RenderManifestCompileFailure {
  const copied = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    path: [...diagnostic.path]
  }));
  return {
    success: false,
    ok: false,
    manifest: null,
    diagnostics: copied,
    errors: copied,
    warnings: warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

function successV24(
  manifest: RenderManifestV24,
  warnings: readonly RenderManifestWarning[]
): RenderManifestCompileSuccess<RenderManifestV24> {
  return {
    success: true,
    ok: true,
    manifest: orderedManifestV24(manifest),
    diagnostics: [],
    errors: [],
    warnings: warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

export function compileRenderManifestV24(
  input: RenderManifestCompilerInput,
  options: RenderManifestCompileOptions = {}
): RenderManifestCompileResult<RenderManifestV24> {
  const diagnostics: RenderManifestDiagnostic[] = [];
  const projectRaw = input.project ?? input.videoProject;
  const audioRaw = input.audioIndex ?? input.audio;
  const projectResult = videoProjectSchema.safeParse(projectRaw);
  const currentLineIds = projectResult.success
    ? new Set(
        projectResult.data.script.sections.flatMap((section) =>
          section.lines.map((line) => line.id)
        )
      )
    : undefined;
  const effectiveAudioIndexRaw =
    currentLineIds === undefined || !isPlainRecord(audioRaw)
      ? audioRaw
      : Object.fromEntries(
          Object.entries(audioRaw).filter(([lineId]) =>
            currentLineIds.has(lineId)
          )
        );
  const audioResult = voicevoxAudioIndexSchema.safeParse(
    effectiveAudioIndexRaw
  );
  const assets = normalizeAssets(recordInputAssets(input), diagnostics);
  const assetLookup = getAssetLookup(assets);
  const screenTemplates = normalizeScreenTemplates(
    recordInputScreenTemplates(input),
    diagnostics
  );
  const catalog = normalizeCatalog(recordInputCatalog(input), diagnostics);
  const catalogByKey = new Map(
    catalog.map((variant) => [
      catalogVariantKey(variant.visualId, variant.variantId),
      variant
    ])
  );
  const catalogById = new Map<string, NormalizedCatalogVariant[]>();
  for (const variant of catalog) {
    const variantsWithId = catalogById.get(variant.variantId) ?? [];
    variantsWithId.push(variant);
    catalogById.set(variant.variantId, variantsWithId);
  }
  const catalogIndex: CatalogIndex = { byKey: catalogByKey, byId: catalogById };
  const characterCatalogVersion = validateVersion(
    input.characterCatalogVersion,
    CHARACTER_VARIANT_CATALOG_VERSION,
    RENDER_MANIFEST_ERROR_CODE.catalogVersion,
    "characterCatalogVersion",
    diagnostics
  );
  const characterMappingVersion = validateVersion(
    input.characterMappingVersion,
    CHARACTER_VARIANT_MAPPING_VERSION,
    RENDER_MANIFEST_ERROR_CODE.mappingVersion,
    "characterMappingVersion",
    diagnostics
  );

  if (!projectResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.videoProjectSchema,
      projectResult.error,
      []
    );
  }
  if (!audioResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.voicevoxAudioIndexSchema,
      audioResult.error,
      ["audioIndex"]
    );
  }

  if (!projectResult.success || !audioResult.success) {
    return failure(diagnostics);
  }

  const project = projectResult.data;
  const effectiveAudioIndex = audioResult.data;
  const sourceProjectHash = sha256CanonicalJson(project);

  for (const [
    assignmentIndex,
    assignment
  ] of project.visuals.assignments.entries()) {
    if (
      assignment.display.kind === "video" &&
      assignment.display.playbackCues.length > 0
    ) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.visualPlaybackCuesUnsupported,
        ["visuals", "assignments", assignmentIndex, "display", "playbackCues"],
        "RenderManifest 2.4.0 cannot represent video playback cues; compile with RenderManifest 2.5.0.",
        {
          assignmentId: assignment.id,
          assetPath: assignment.projectMediaPath
        }
      );
    }
  }

  if (project.script.sections.length === 0) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.emptyScript,
      ["script", "sections"],
      "at least one non-empty script section is required"
    );
  }
  for (const [sectionIndex, section] of project.script.sections.entries()) {
    if (section.lines.length === 0) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.emptySection,
        ["script", "sections", sectionIndex, "lines"],
        "a script section must contain at least one line",
        { sectionId: section.id }
      );
    }
  }

  const lineEntries: LineEntry[] = project.script.sections.flatMap(
    (section, sectionIndex) =>
      section.lines.map((line, lineIndex) => ({
        sectionIndex,
        sectionId: section.id,
        lineIndex,
        line
      }))
  );
  const lineIndexById = new Map(
    lineEntries.map((entry) => [entry.line.id, entry])
  );
  const templateBindingByLineId = new Map<string, ResolvedScreenTemplate>();
  const sectionTemplateBindingById = new Map<string, ResolvedScreenTemplate>();
  const linePriority = linePrioritySet(project, lineEntries);
  const charactersForLayout = project.characters.map((character) => ({
    id: character.id
  }));
  const resolvedLayoutByLineId = new Map<string, ResolvedScreenLayout>();
  for (const [sectionIndex, section] of project.script.sections.entries()) {
    const binding = screenTemplates.get(section.screenTemplateId);
    if (binding === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.screenTemplateMissing,
        ["script", "sections", sectionIndex, "screenTemplateId"],
        "selected screen template is missing from the validated snapshot",
        { sectionId: section.id }
      );
      continue;
    }
    if (binding.template.status !== "active") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.screenTemplateInactive,
        ["script", "sections", sectionIndex, "screenTemplateId"],
        "selected screen template is inactive",
        { sectionId: section.id }
      );
      continue;
    }
    for (const issue of screenTemplateTextValidationIssues(binding.template, {
      sectionTitleText: section.name
    })) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.screenTemplateTextOverflow,
        ["script", "sections", sectionIndex, "name"],
        issue.message,
        { sectionId: section.id }
      );
    }
    sectionTemplateBindingById.set(section.id, binding);
  }

  for (const entry of lineEntries) {
    const binding = sectionTemplateBindingById.get(entry.sectionId);
    if (binding === undefined) {
      continue;
    }
    const path = [
      "script",
      "sections",
      entry.sectionIndex,
      "lines",
      entry.lineIndex,
      "subtitleText"
    ];
    for (const issue of screenTemplateTextValidationIssues(binding.template, {
      dialogueText: entry.line.subtitleText
    })) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.screenTemplateTextOverflow,
        [
          "script",
          "sections",
          entry.sectionIndex,
          "lines",
          entry.lineIndex,
          "subtitleText"
        ],
        issue.message,
        { lineId: entry.line.id, sectionId: entry.sectionId }
      );
    }
    const prioritizeVisual = linePriority.has(entry.line.id);
    const resolvedLayout = resolvedLayoutForTemplate(
      binding,
      charactersForLayout,
      prioritizeVisual
    );
    if (prioritizeVisual) {
      for (const issue of resolvedScreenLayoutValidationIssues(
        resolvedLayout
      )) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.screenLayoutCharacterMissing,
          [...path, "resolvedLayout", ...issue.path],
          issue.message,
          { lineId: entry.line.id, sectionId: entry.sectionId }
        );
      }
    }
    templateBindingByLineId.set(entry.line.id, binding);
    resolvedLayoutByLineId.set(entry.line.id, resolvedLayout);
  }

  const sourceAssets = new Map<string, string>();
  const lineAudio = new Map<string, VoicevoxAudioIndexEntry>();
  for (const entry of lineEntries) {
    const audioEntry = effectiveAudioIndex[entry.line.id];
    if (audioEntry === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.audioMissing,
        ["audioIndex", entry.line.id],
        "each script line must have exactly one audio index entry",
        { lineId: entry.line.id }
      );
      continue;
    }
    lineAudio.set(entry.line.id, audioEntry);
    const audioAsset = requireAsset(
      assetLookup,
      audioEntry.audioPath,
      ["audio", "voice"],
      diagnostics,
      ["audioIndex", entry.line.id, "audioPath"],
      { lineId: entry.line.id },
      audioEntry.audioSha256,
      true,
      RENDER_MANIFEST_ERROR_CODE.audioAssetChecksumMismatch
    );
    if (audioAsset !== undefined) {
      if (audioAsset.kind !== "audio" && audioAsset.kind !== "voice") {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.audioAssetKindMismatch,
          ["audioIndex", entry.line.id, "audioPath"],
          "voice audio asset kind must be audio or voice",
          { lineId: entry.line.id, assetPath: audioEntry.audioPath }
        );
      }
      if (
        audioAsset.durationMs !== undefined &&
        audioAsset.durationMs !== null &&
        audioAsset.durationMs !== audioEntry.durationMs
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.audioDurationMismatch,
          ["audioIndex", entry.line.id, "durationMs"],
          "audio metadata durationMs does not match the audio index",
          { lineId: entry.line.id, assetPath: audioEntry.audioPath }
        );
      }
      addSourceAsset(sourceAssets, audioAsset, diagnostics, {
        lineId: entry.line.id
      });
    }
  }

  for (const [
    assignmentIndex,
    assignment
  ] of project.visuals.assignments.entries()) {
    const asset = requireAsset(
      assetLookup,
      assignment.projectMediaPath,
      [assignment.display.kind],
      diagnostics,
      ["visuals", "assignments", assignmentIndex, "projectMediaPath"],
      { assignmentId: assignment.id },
      assignment.assetChecksum,
      assignment.display.kind === "video"
    );
    if (asset !== undefined) {
      addSourceAsset(sourceAssets, asset, diagnostics, {
        assignmentId: assignment.id
      });
      if (assignment.display.kind === "document_scan") {
        if (asset.pageCount === undefined || asset.pageCount === null) {
          addDiagnostic(
            diagnostics,
            RENDER_MANIFEST_ERROR_CODE.assetPageCountMissing,
            ["visuals", "assignments", assignmentIndex, "display", "page"],
            "document_scan asset metadata pageCount is required",
            {
              assignmentId: assignment.id,
              assetPath: assignment.projectMediaPath
            }
          );
        } else if (
          assignment.display.page < 1 ||
          assignment.display.page > asset.pageCount
        ) {
          addDiagnostic(
            diagnostics,
            RENDER_MANIFEST_ERROR_CODE.assetRangeInvalid,
            ["visuals", "assignments", assignmentIndex, "display", "page"],
            "document_scan display page must be between 1 and the verified asset pageCount",
            {
              assignmentId: assignment.id,
              assetPath: assignment.projectMediaPath
            }
          );
        }
      }
      if (
        assignment.display.kind === "video" &&
        asset.durationMs !== undefined &&
        asset.durationMs !== null &&
        assignment.display.endMs > asset.durationMs
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.assetRangeInvalid,
          ["visuals", "assignments", assignmentIndex, "display", "endMs"],
          "video display endMs exceeds the verified asset duration",
          {
            assignmentId: assignment.id,
            assetPath: assignment.projectMediaPath
          }
        );
      }
    }
  }

  for (const [sectionIndex, section] of project.script.sections.entries()) {
    if (section.background.kind !== "image") {
      continue;
    }
    const asset = requireAsset(
      assetLookup,
      section.background.src,
      ["image", "photo"],
      diagnostics,
      ["script", "sections", sectionIndex, "background", "src"],
      { sectionId: section.id }
    );
    if (asset !== undefined) {
      addSourceAsset(sourceAssets, asset, diagnostics, {
        sectionId: section.id
      });
    }
  }

  const editVideoAssets = new Map<string, RenderManifestAssetMetadata>();
  for (const [elementIndex, element] of project.edit.videoElements.entries()) {
    const asset = requireAsset(
      assetLookup,
      element.projectMediaPath,
      ["video"],
      diagnostics,
      ["edit", "videoElements", elementIndex, "projectMediaPath"],
      { assignmentId: element.id, assetPath: element.projectMediaPath },
      element.assetChecksum,
      true
    );
    if (asset !== undefined) {
      validateEditAssetFormat(
        asset,
        "video",
        diagnostics,
        ["edit", "videoElements", elementIndex, "projectMediaPath"],
        { assignmentId: element.id, assetPath: element.projectMediaPath }
      );
      if (
        options.resolveEditVideoTiming === true &&
        asset.durationMs !== undefined &&
        asset.durationMs !== null &&
        element.startMs !== null &&
        element.startMs >= asset.durationMs
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.assetRangeInvalid,
          ["edit", "videoElements", elementIndex, "startMs"],
          "edit video startMs must be less than the verified asset duration",
          { assignmentId: element.id, assetPath: element.projectMediaPath }
        );
      }
      editVideoAssets.set(element.id, asset);
      addSourceAsset(sourceAssets, asset, diagnostics, {
        assignmentId: element.id,
        assetPath: element.projectMediaPath
      });
    }
  }

  for (const [bgmIndex, bgm] of project.edit.sectionBgms.entries()) {
    const asset = requireAsset(
      assetLookup,
      bgm.projectMediaPath,
      ["audio", "bgm"],
      diagnostics,
      ["edit", "sectionBgms", bgmIndex, "projectMediaPath"],
      { sectionId: bgm.sectionId, assetPath: bgm.projectMediaPath },
      bgm.assetChecksum,
      true
    );
    if (asset !== undefined) {
      validateEditAssetFormat(
        asset,
        "bgm",
        diagnostics,
        ["edit", "sectionBgms", bgmIndex, "projectMediaPath"],
        { sectionId: bgm.sectionId, assetPath: bgm.projectMediaPath }
      );
      addSourceAsset(sourceAssets, asset, diagnostics, {
        sectionId: bgm.sectionId
      });
    }
  }

  const soundEffectAssets = new Map<string, RenderManifestAssetMetadata>();
  for (const [effectIndex, effect] of project.audio.soundEffects.entries()) {
    const asset = requireAsset(
      assetLookup,
      effect.projectMediaPath,
      ["sound_effect", "audio"],
      diagnostics,
      ["audio", "soundEffects", effectIndex, "projectMediaPath"],
      { lineId: effect.lineId, assetPath: effect.projectMediaPath },
      effect.assetChecksum,
      true
    );
    if (asset !== undefined) {
      soundEffectAssets.set(effect.id, asset);
      addSourceAsset(sourceAssets, asset, diagnostics, {
        lineId: effect.lineId
      });
    }
  }

  const idleVariantIds = new Map<string, string>();
  const lineVariantIds = new Map<string, string>();
  const referencedVariants = new Map<
    string,
    { readonly visualId: string; readonly variantId: string }
  >();
  const projectCharactersById = new Map(
    project.characters.map((character) => [character.id, character])
  );
  for (const character of project.characters) {
    const binding = character.characterVisual;
    if (binding.visualId === null) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.characterVisualBindingMissing,
        ["characters", character.id, "characterVisual", "visualId"],
        "an explicit character visual binding is required for every project character",
        { sectionId: character.id }
      );
      continue;
    }
    if (binding.idleVariantId === null) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.characterVariantUnselected,
        ["characters", character.id, "characterVisual", "idleVariantId"],
        "an explicit idle variant selection is required for every project character",
        { sectionId: character.id }
      );
      continue;
    }

    idleVariantIds.set(character.id, binding.idleVariantId);
    referencedVariants.set(
      catalogVariantKey(binding.visualId, binding.idleVariantId),
      { visualId: binding.visualId, variantId: binding.idleVariantId }
    );
    const resolvedIdleVariant = variantForId(
      catalogIndex,
      binding.idleVariantId,
      binding.visualId,
      diagnostics,
      {
        sectionId: character.id,
        variantId: binding.idleVariantId
      }
    );
    if (resolvedIdleVariant !== undefined) {
      referencedVariants.set(
        catalogVariantKey(
          resolvedIdleVariant.visualId,
          resolvedIdleVariant.variantId
        ),
        {
          visualId: resolvedIdleVariant.visualId,
          variantId: resolvedIdleVariant.variantId
        }
      );
    }
  }
  for (const entry of lineEntries) {
    const variantId = entry.line.characterVariantId;
    if (variantId === undefined || variantId === null) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.characterVariantUnselected,
        [
          "script",
          "sections",
          entry.sectionIndex,
          "lines",
          entry.lineIndex,
          "characterVariantId"
        ],
        "a physical character variant must be explicitly selected for every script line",
        { lineId: entry.line.id, sectionId: entry.sectionId }
      );
      continue;
    }

    const speaker = projectCharactersById.get(entry.line.speakerId);
    const visualId = speaker?.characterVisual.visualId;
    if (visualId === undefined || visualId === null) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.characterVisualBindingMissing,
        [
          "script",
          "sections",
          entry.sectionIndex,
          "lines",
          entry.lineIndex,
          "speakerId"
        ],
        "the line speaker must have an explicit character visual binding",
        { lineId: entry.line.id, sectionId: entry.sectionId, variantId }
      );
      continue;
    }
    lineVariantIds.set(entry.line.id, variantId);
    referencedVariants.set(catalogVariantKey(visualId, variantId), {
      visualId,
      variantId
    });
    const resolvedLineVariant = variantForId(
      catalogIndex,
      variantId,
      visualId,
      diagnostics,
      {
        lineId: entry.line.id,
        sectionId: entry.sectionId,
        variantId
      }
    );
    if (resolvedLineVariant !== undefined) {
      referencedVariants.set(
        catalogVariantKey(
          resolvedLineVariant.visualId,
          resolvedLineVariant.variantId
        ),
        {
          visualId: resolvedLineVariant.visualId,
          variantId: resolvedLineVariant.variantId
        }
      );
    }
  }

  const resolvedCharacterVariants = new Map<string, RenderCharacterVariant>();
  for (const reference of [...referencedVariants.values()].sort((left, right) =>
    compareStrings(
      catalogVariantKey(left.visualId, left.variantId),
      catalogVariantKey(right.visualId, right.variantId)
    )
  )) {
    const { visualId, variantId } = reference;
    const catalogVariant = catalogIndex.byKey.get(
      catalogVariantKey(visualId, variantId)
    );
    if (catalogVariant === undefined) {
      continue;
    }
    const resolvedFiles: Record<string, { path: string; sha256: string }> = {};
    const expectedKeys =
      catalogVariant.renderType === "single-image"
        ? ["single"]
        : ["closed", "open"];
    for (const key of expectedKeys) {
      const file = catalogVariant.files.get(key);
      if (file === undefined) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.variantFileMissing,
          ["characterVariantCatalog", catalogVariant.inputIndex, "files", key],
          "mapped character variant file is missing",
          { variantId, assetPath: undefined }
        );
        continue;
      }
      const asset = requireAsset(
        assetLookup,
        file.destinationPath,
        ["character", "image", "photo"],
        diagnostics,
        ["characterVariants", variantId, "files", key, "path"],
        { variantId, assetPath: file.destinationPath },
        file.checksum,
        false,
        RENDER_MANIFEST_ERROR_CODE.variantFileChecksumMismatch
      );
      if (asset === undefined) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.variantFileMissing,
          ["characterVariants", variantId, "files", key, "path"],
          "character variant file metadata is missing",
          { variantId, assetPath: file.destinationPath }
        );
        continue;
      }
      if (!expectedCharacterKinds(asset.kind)) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.variantFileKindMismatch,
          ["characterVariants", variantId, "files", key, "path"],
          "character variant file metadata must describe an image",
          { variantId, assetPath: file.destinationPath }
        );
      }
      addSourceAsset(sourceAssets, asset, diagnostics, {
        variantId,
        assetPath: file.destinationPath
      });
      resolvedFiles[key] = {
        path: file.destinationPath,
        sha256: normalizeChecksum(asset.sha256)
      };
    }
    if (catalogVariant.renderType === "single-image") {
      const single = resolvedFiles.single;
      if (single !== undefined) {
        resolvedCharacterVariants.set(
          catalogVariantKey(catalogVariant.visualId, variantId),
          {
            variantId,
            visualId: catalogVariant.visualId,
            renderType: "single-image",
            files: { single }
          }
        );
      }
    } else {
      const closed = resolvedFiles.closed;
      const open = resolvedFiles.open;
      if (closed !== undefined && open !== undefined) {
        resolvedCharacterVariants.set(
          catalogVariantKey(catalogVariant.visualId, variantId),
          {
            variantId,
            visualId: catalogVariant.visualId,
            renderType: "mouth-pair",
            files: { closed, open }
          }
        );
      }
    }
  }

  let lineRanges: TimelineLineRange[] | undefined;
  let sectionRanges: ReturnType<typeof calculateSectionRanges> | undefined;
  let visualRanges: ReturnType<typeof calculateVisualRanges> | undefined;
  if (lineEntries.every((entry) => lineAudio.has(entry.line.id))) {
    lineRanges = calculateLineRanges(
      lineEntries.map((entry) => ({
        id: entry.line.id,
        sectionId: entry.sectionId,
        pauseBeforeMs: entry.line.pauseBeforeMs,
        durationMs: lineAudio.get(entry.line.id)?.durationMs ?? 0,
        pauseAfterMs: entry.line.pauseAfterMs
      })),
      project.metadata.outputSettings.fps
    );
    sectionRanges = calculateSectionRanges(lineRanges);

    let visualRangeError = false;
    for (const [
      assignmentIndex,
      assignment
    ] of project.visuals.assignments.entries()) {
      const start = lineRanges.find(
        (line) => line.id === assignment.startLineId
      );
      const end = lineRanges.find((line) => line.id === assignment.endLineId);
      if (start === undefined || end === undefined) {
        visualRangeError = true;
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.visualRangeInvalid,
          ["visuals", "assignments", assignmentIndex],
          "visual assignment line range cannot be resolved",
          { assignmentId: assignment.id }
        );
      } else if (start.sectionId !== end.sectionId || start.from > end.from) {
        visualRangeError = true;
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.visualRangeInvalid,
          ["visuals", "assignments", assignmentIndex],
          "visual assignment must stay within an ordered section range",
          { assignmentId: assignment.id, sectionId: start.sectionId }
        );
      }
    }
    if (!visualRangeError) {
      try {
        visualRanges = calculateVisualRanges(
          project.visuals.assignments,
          lineRanges
        );
      } catch (error) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.visualRangeInvalid,
          ["visuals", "assignments"],
          error instanceof Error
            ? error.message
            : "visual range calculation failed"
        );
      }
    }
  }

  // Do not assemble resolved layouts or visual segments after semantic
  // validation has failed. In particular, invalid templates are intentionally
  // absent from the normalized map so resolution cannot throw on partial
  // geometry.
  if (
    diagnostics.length > 0 ||
    lineRanges === undefined ||
    sectionRanges === undefined ||
    visualRanges === undefined
  ) {
    return failure(diagnostics);
  }

  const fps = project.metadata.outputSettings.fps;
  const sectionRangeById = new Map(
    sectionRanges.map((range) => [range.sectionId, range])
  );
  const lineRangeById = new Map(lineRanges.map((range) => [range.id, range]));
  const editVideoTimeline = calculateEditVideoTimeline(
    project.edit.videoElements.map((element, inputIndex) => {
      const asset = editVideoAssets.get(element.id);
      if (asset?.durationMs === undefined || asset.durationMs === null) {
        throw new Error(`edit video duration is missing: ${element.id}`);
      }
      return {
        id: element.id,
        role: element.role,
        placement: element.placement,
        volume: element.volume,
        projectMediaPath: element.projectMediaPath,
        text: element.text,
        textTemplateId: element.textTemplateId,
        startMs:
          options.resolveEditVideoTiming === true ? element.startMs : null,
        playbackRate:
          options.resolveEditVideoTiming === true ? element.playbackRate : 1,
        durationInFrames: effectiveMediaDurationInFrames(
          asset.durationMs,
          options.resolveEditVideoTiming === true ? element.startMs : null,
          options.resolveEditVideoTiming === true ? element.playbackRate : 1,
          fps
        ),
        inputIndex
      };
    }),
    sectionRanges
  );

  const sourceAssetChecksums = [...sourceAssets.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, sha256]) => ({ path, sha256 }));
  const normalizedAssetsForHash = assets
    .filter((asset) => sourceAssets.has(asset.path))
    .map((asset) => ({
      path: asset.path,
      kind: asset.kind,
      sha256: normalizeChecksum(asset.sha256),
      ...(asset.durationMs === undefined
        ? {}
        : { durationMs: asset.durationMs }),
      ...(asset.pageCount === undefined ? {} : { pageCount: asset.pageCount }),
      ...(typeof asset.mimeType === "string"
        ? { mimeType: asset.mimeType }
        : {}),
      ...(typeof asset.format === "string" ? { format: asset.format } : {})
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
  const catalogForHash = catalog.map((variant) => ({
    variantId: variant.variantId,
    visualId: variant.visualId,
    renderType: variant.renderType,
    files: [...variant.files.values()]
      .sort((left, right) => compareStrings(left.key, right.key))
      .map((file) => ({
        key: file.key,
        destinationPath: file.destinationPath,
        ...(file.checksum === undefined ? {} : { checksum: file.checksum })
      }))
  }));
  const characterSelectionForHash = {
    characters: project.characters.map((character) => ({
      characterId: character.id,
      visualId: character.characterVisual.visualId,
      idleVariantId: character.characterVisual.idleVariantId
    })),
    lines: lineEntries.map((entry) => ({
      lineId: entry.line.id,
      characterVariantId: entry.line.characterVariantId ?? null
    }))
  };
  const referencedScreenTemplateIds = sortedUniqueStrings(
    project.script.sections.map((section) => section.screenTemplateId)
  );
  const screenTemplateForHash = referencedScreenTemplateIds.map(
    (templateId) => {
      const binding = screenTemplates.get(templateId);
      return {
        templateId,
        revision: binding?.templateRevision ?? null,
        hash: binding?.templateHash ?? null,
        template:
          binding === undefined
            ? null
            : {
                canvasWidth: binding.template.canvasWidth,
                canvasHeight: binding.template.canvasHeight,
                elements: screenTemplateElementsForV24Hash(
                  binding.template.elements
                )
              },
        sectionIds: project.script.sections
          .filter((section) => section.screenTemplateId === templateId)
          .map((section) => section.id)
      };
    }
  );
  const renderLines: RenderLineV24[] = lineEntries.map((entry) => {
    const baseRange = lineRangeById.get(entry.line.id);
    if (baseRange === undefined) {
      throw new Error(`line range is missing: ${entry.line.id}`);
    }
    const from = shiftedFrom(
      baseRange.from,
      entry.sectionId,
      editVideoTimeline.sectionShiftById
    );
    const audioEntry = lineAudio.get(entry.line.id);
    const characterVariantId = lineVariantIds.get(entry.line.id);
    if (audioEntry === undefined || characterVariantId === undefined) {
      throw new Error(
        `validated line dependencies are missing: ${entry.line.id}`
      );
    }
    return {
      id: entry.line.id,
      sectionId: entry.sectionId,
      from,
      durationInFrames: baseRange.durationInFrames,
      speechFrom: baseRange.speechFrom,
      speechDurationInFrames: baseRange.speechDurationInFrames,
      audioPath: audioEntry.audioPath,
      subtitleText: entry.line.subtitleText,
      speakerId: entry.line.speakerId,
      expression: entry.line.expression,
      characterVariantId,
      screenTemplateId:
        templateBindingByLineId.get(entry.line.id)?.templateId ??
        project.script.sections[entry.sectionIndex]?.screenTemplateId ??
        "screen-template-missing",
      templateRevision:
        templateBindingByLineId.get(entry.line.id)?.templateRevision ?? 1,
      templateHash:
        templateBindingByLineId.get(entry.line.id)?.templateHash ??
        "0".repeat(64),
      resolvedLayout:
        resolvedLayoutByLineId.get(entry.line.id) ??
        ({
          canvasWidth: 1920,
          canvasHeight: 1080,
          elements: []
        } as ResolvedScreenLayout)
    };
  });

  const visualValues = buildVisualSegments({
    project,
    lineEntries,
    lineRangeById,
    lineIndexById,
    visualRanges,
    sectionShiftById: editVideoTimeline.sectionShiftById,
    templates: screenTemplates,
    characters: charactersForLayout,
    fps,
    diagnostics
  });

  const sectionLayouts: RenderSectionLayout[] = project.script.sections.map(
    (section) => {
      const binding = sectionTemplateBindingById.get(section.id);
      if (binding === undefined) {
        throw new Error(`section template binding is missing: ${section.id}`);
      }
      return {
        sectionId: section.id,
        sectionTitle: section.name,
        templateId: binding.templateId,
        templateRevision: binding.templateRevision,
        templateHash: binding.templateHash,
        resolvedLayout: resolvedLayoutForTemplate(
          binding,
          charactersForLayout,
          false
        )
      };
    }
  );
  const compilerInputHash = computeCompilerInputHash({
    project,
    audioIndex: effectiveAudioIndex,
    assets: normalizedAssetsForHash,
    characterCatalogVersion,
    characterMappingVersion,
    characterCatalog: catalogForHash,
    characterSelection: characterSelectionForHash,
    screenTemplateSelection: referencedScreenTemplateIds.map((templateId) => ({
      templateId,
      sections: project.script.sections
        .filter((section) => section.screenTemplateId === templateId)
        .map((section) => section.id)
    })),
    screenTemplate: screenTemplateForHash,
    sectionLayouts,
    visualSegments: visualValues
  });

  const renderBackgrounds = project.script.sections.map((section) => {
    const range = sectionRangeById.get(section.id);
    if (range === undefined) {
      throw new Error(`section range is missing: ${section.id}`);
    }
    return {
      sectionId: section.id,
      from: shiftedFrom(
        range.from,
        section.id,
        editVideoTimeline.sectionShiftById
      ),
      durationInFrames: range.durationInFrames,
      background: section.background
    } satisfies RenderBackground;
  });

  const renderAudioTracks = stableTimelineSort(
    project.edit.sectionBgms.map((bgm, inputIndex) => {
      const range = sectionRangeById.get(bgm.sectionId);
      if (range === undefined) {
        throw new Error(`BGM section range is missing: ${bgm.sectionId}`);
      }
      return {
        inputIndex,
        value: {
          id: bgm.id,
          sectionId: bgm.sectionId,
          from: shiftedFrom(
            range.from,
            bgm.sectionId,
            editVideoTimeline.sectionShiftById
          ),
          durationInFrames: range.durationInFrames,
          src: bgm.projectMediaPath,
          volume: bgm.volume,
          loop: true
        }
      };
    })
  );

  const renderSoundEffects = stableTimelineSort(
    project.audio.soundEffects.map((effect, inputIndex) => {
      const lineRange = lineRangeById.get(effect.lineId);
      const lineEntry = lineIndexById.get(effect.lineId);
      const asset = soundEffectAssets.get(effect.id);
      if (
        lineRange === undefined ||
        lineEntry === undefined ||
        asset?.durationMs === undefined ||
        asset.durationMs === null
      ) {
        throw new Error(`sound effect dependency is missing: ${effect.id}`);
      }
      const durationInFrames = msToFrames(asset.durationMs, fps);
      const from =
        shiftedFrom(
          lineRange.from,
          lineEntry.sectionId,
          editVideoTimeline.sectionShiftById
        ) +
        lineRange.speechFrom +
        msToFrames(effect.offsetMs, fps);
      if (
        from + durationInFrames >
        shiftedFrom(
          lineRange.from,
          lineEntry.sectionId,
          editVideoTimeline.sectionShiftById
        ) +
          lineRange.durationInFrames
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.assetRangeInvalid,
          ["audio", "soundEffects", inputIndex, "offsetMs"],
          "sound effect must fit within the target line interval",
          { lineId: effect.lineId, assetPath: effect.projectMediaPath }
        );
      }
      return {
        inputIndex,
        value: {
          id: effect.id,
          lineId: effect.lineId,
          category: effect.category,
          from,
          durationInFrames,
          src: effect.projectMediaPath,
          volume: effect.volume
        }
      } satisfies { inputIndex: number; value: RenderSoundEffect };
    })
  );
  const warnings = detectSoundEffectWarnings(renderSoundEffects);

  const renderInserts: RenderInsert[] = editVideoTimeline.inserts.map(
    (insert) => ({
      id: insert.id,
      role: insert.role,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      src: insert.src,
      volume: insert.volume
    })
  );
  const durationInFrames = editVideoTimeline.durationInFrames;

  const characters: RenderCharacter[] = project.characters.map((character) => {
    const visualId = character.characterVisual.visualId;
    const idleVariantId = idleVariantIds.get(character.id);
    if (visualId === null || idleVariantId === undefined) {
      throw new Error(`idle variant is missing: ${character.id}`);
    }
    return {
      characterId: character.id,
      visualId,
      displayName: character.name,
      themeColorToken: character.themeColorToken,
      lipSyncPeriodFrames: character.lipSyncPeriodFrames,
      idleVariantId
    };
  });
  const characterVariants = [...resolvedCharacterVariants.values()].sort(
    (left, right) =>
      compareStrings(
        catalogVariantKey(left.visualId, left.variantId),
        catalogVariantKey(right.visualId, right.variantId)
      )
  );
  const manifest = {
    manifestVersion: RENDER_MANIFEST_V24_VERSION,
    sourceProjectHash,
    compilerInputHash,
    characterCatalogVersion,
    characterMappingVersion,
    characters,
    characterVariants,
    sourceAssetChecksums,
    fps,
    width: project.metadata.outputSettings.width,
    height: project.metadata.outputSettings.height,
    durationInFrames,
    sectionLayouts,
    lines: renderLines,
    visuals: visualValues,
    backgrounds: renderBackgrounds,
    audioTracks: renderAudioTracks,
    soundEffects: renderSoundEffects,
    inserts: renderInserts
  };
  const manifestResult = renderManifestV24Schema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics, warnings);
  }
  if (diagnostics.length > 0) {
    return failure(diagnostics, warnings);
  }
  return successV24(manifestResult.data, warnings);
}

type V25PlaybackState = "playing" | "paused" | "ended";

type PlaybackFrameSample = Readonly<{
  readonly frame: number;
  readonly state: V25PlaybackState;
  readonly sourceFrame: number;
}>;

function playbackScriptForProject(project: z.infer<typeof videoProjectSchema>) {
  return {
    sections: project.script.sections.map((section) => ({
      id: section.id,
      lines: section.lines.map((line) => ({ id: line.id }))
    }))
  };
}

function v25LayoutIntervals(
  baseManifest: RenderManifestV24
): RenderLayoutInterval[] {
  return baseManifest.lines.map((line) => ({
    sectionId: line.sectionId,
    from: line.from,
    durationInFrames: line.durationInFrames,
    resolvedLayout: line.resolvedLayout
  }));
}

function projectWithoutPlaybackCues(
  project: z.infer<typeof videoProjectSchema>
): z.infer<typeof videoProjectSchema> {
  return {
    ...project,
    visuals: {
      ...project.visuals,
      assignments: project.visuals.assignments.map((assignment) => ({
        ...assignment,
        display:
          assignment.display.kind === "video"
            ? { ...assignment.display, playbackCues: [] }
            : assignment.display
      }))
    }
  };
}

function validateV25PlaybackCues(
  project: z.infer<typeof videoProjectSchema>,
  diagnostics: RenderManifestDiagnostic[]
): boolean {
  const script = playbackScriptForProject(project);
  let valid = true;
  for (const [
    assignmentIndex,
    assignment
  ] of project.visuals.assignments.entries()) {
    const result = validateVisualPlaybackSequence(assignment, script);
    if (result.success) {
      continue;
    }
    valid = false;
    for (const issue of result.issues) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.visualPlaybackCueInvalid,
        ["visuals", "assignments", assignmentIndex, ...issue.path],
        issue.message,
        {
          assignmentId: assignment.id,
          sectionId: project.script.sections.find((section) =>
            section.lines.some((line) => line.id === assignment.startLineId)
          )?.id
        }
      );
    }
  }
  return valid;
}

function cueFrame(
  cue: VisualPlaybackCue,
  lineById: ReadonlyMap<string, RenderLineV24>
): number | undefined {
  const line = lineById.get(cue.lineId);
  if (line === undefined) {
    return undefined;
  }
  return cue.edge === "before" ? line.from : line.from + line.durationInFrames;
}

function lineAtFrame(
  lines: readonly RenderLineV24[],
  frame: number
): RenderLineV24 | undefined {
  return lines.find(
    (line) => frame >= line.from && frame < line.from + line.durationInFrames
  );
}

function buildV25VideoSegments(
  assignment: z.infer<
    typeof videoProjectSchema
  >["visuals"]["assignments"][number],
  baseVisual: Extract<RenderVisualV24, { kind: "video" }>,
  baseLines: readonly RenderLineV24[],
  script: ReturnType<typeof playbackScriptForProject>,
  fps: number,
  assignmentIndex: number,
  baseCompilerInputHash: string,
  diagnostics: RenderManifestDiagnostic[]
): RenderVisualV25[] {
  const validation = validateVisualPlaybackSequence(assignment, script);
  if (!validation.success) {
    return [];
  }

  const display = baseVisual.display;
  const sourceStartFrame = mediaMillisecondsToFrames(display.startMs, fps);
  const sourceEndFrame = mediaMillisecondsToFrames(display.endMs, fps);
  if (sourceEndFrame <= sourceStartFrame) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.visualSourceRangeInvalid,
      ["visuals", "assignments", assignmentIndex, "display"],
      "video source range must contain at least one source frame",
      {
        assignmentId: assignment.id,
        assetPath: assignment.projectMediaPath
      }
    );
    return [];
  }

  const lineById = new Map(baseLines.map((line) => [line.id, line]));
  const cuesByFrame = new Map<number, VisualPlaybackCue[]>();
  for (const cue of validation.orderedCues) {
    const frame = cueFrame(cue, lineById);
    if (frame === undefined) {
      continue;
    }
    const cues = cuesByFrame.get(frame) ?? [];
    cues.push(cue);
    cuesByFrame.set(frame, cues);
  }

  const samples: PlaybackFrameSample[] = [];
  let state: V25PlaybackState = "playing";
  let sourceFrame = sourceStartFrame;
  const from = baseVisual.from;
  const to = baseVisual.from + baseVisual.durationInFrames;
  let ended = false;

  for (let frame = from; frame < to; frame += 1) {
    const cues = cuesByFrame.get(frame) ?? [];
    if (!ended && sourceFrame >= sourceEndFrame) {
      ended = true;
      state = "ended";
    }

    if (ended) {
      if (cues.length > 0) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.visualPlaybackCueInvalid,
          [
            "visuals",
            "assignments",
            assignmentIndex,
            "display",
            "playbackCues"
          ],
          "playback cue is invalid after the video source has ended",
          {
            assignmentId: assignment.id,
            assetPath: assignment.projectMediaPath
          }
        );
      }
    } else {
      for (const cue of cues) {
        state = cue.action === "pause" ? "paused" : "playing";
      }
    }

    samples.push({ frame, state, sourceFrame });
    if (state === "playing") {
      sourceFrame += display.playbackRate;
    }
  }

  const endCues = cuesByFrame.get(to) ?? [];
  if (endCues.length > 0 && sourceFrame >= sourceEndFrame) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.visualPlaybackCueInvalid,
      ["visuals", "assignments", assignmentIndex, "display", "playbackCues"],
      "playback cue is invalid after the video source has ended",
      {
        assignmentId: assignment.id,
        assetPath: assignment.projectMediaPath
      }
    );
  }

  if (samples.length === 0) {
    return [];
  }

  const segments: RenderVisualV25[] = [];
  let runStart = 0;
  for (let index = 1; index <= samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    if (next !== undefined && next.state === previous.state) {
      continue;
    }

    const runSamples = samples.slice(runStart, index);
    const runFrom = runSamples[0]!.frame;
    const runTo = runSamples.at(-1)!.frame + 1;
    const startLine = lineAtFrame(baseLines, runFrom) ?? baseLines[0];
    const endLine = lineAtFrame(baseLines, runTo - 1) ?? baseLines.at(-1);
    if (startLine === undefined || endLine === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.visualSegmentRangeInvalid,
        ["visuals", "assignments", assignmentIndex],
        "resolved video segment line range is missing",
        { assignmentId: assignment.id, assetPath: assignment.projectMediaPath }
      );
      runStart = index;
      continue;
    }

    const playbackState = previous.state;
    const firstSourceFrame = runSamples[0]!.sourceFrame;
    const baseDisplay = {
      kind: "video" as const,
      outerFrame: display.outerFrame,
      contentClip: display.contentClip,
      fit: display.fit,
      crop: display.crop,
      annotations: display.annotations,
      startMs: display.startMs,
      endMs: display.endMs,
      playbackRate: display.playbackRate,
      playbackCues: [...validation.orderedCues]
    };
    const resolvedDisplay: Extract<
      RenderVisualV25,
      { kind: "video" }
    >["display"] =
      playbackState === "playing"
        ? {
            ...baseDisplay,
            volume: display.volume,
            playbackState: "playing",
            sourceTrimBeforeFrame: firstSourceFrame,
            sourceTrimAfterFrame: Math.min(
              sourceEndFrame,
              firstSourceFrame + runSamples.length * display.playbackRate
            )
          }
        : playbackState === "paused"
          ? {
              ...baseDisplay,
              volume: 0,
              playbackState: "paused",
              sourceFrame: firstSourceFrame
            }
          : {
              ...baseDisplay,
              volume: 0,
              playbackState: "ended",
              sourceFrame: sourceEndFrame - 1
            };
    const segmentIndex = segments.length;
    const segmentIdentity =
      resolvedDisplay.playbackState === "playing"
        ? {
            manifestVersion: RENDER_MANIFEST_V25_VERSION,
            baseCompilerInputHash,
            sourceAssignmentId: assignment.id,
            segmentIndex,
            from: runFrom,
            durationInFrames: runTo - runFrom,
            segmentStartLineId: startLine.id,
            segmentEndLineId: endLine.id,
            sectionId: startLine.sectionId,
            playbackState: resolvedDisplay.playbackState,
            playbackCues: validation.orderedCues,
            sourceStartFrame,
            sourceEndFrame,
            sourceTrimBeforeFrame: resolvedDisplay.sourceTrimBeforeFrame,
            sourceTrimAfterFrame: resolvedDisplay.sourceTrimAfterFrame
          }
        : {
            manifestVersion: RENDER_MANIFEST_V25_VERSION,
            baseCompilerInputHash,
            sourceAssignmentId: assignment.id,
            segmentIndex,
            from: runFrom,
            durationInFrames: runTo - runFrom,
            segmentStartLineId: startLine.id,
            segmentEndLineId: endLine.id,
            sectionId: startLine.sectionId,
            playbackState: resolvedDisplay.playbackState,
            playbackCues: validation.orderedCues,
            sourceStartFrame,
            sourceEndFrame,
            sourceFrame: resolvedDisplay.sourceFrame
          };
    segments.push({
      id: `visual-${sha256CanonicalJson(segmentIdentity)}`,
      sourceAssignmentId: assignment.id,
      segmentIndex,
      segmentStartLineId: startLine.id,
      segmentEndLineId: endLine.id,
      sectionId: startLine.sectionId,
      templateRevision: baseVisual.templateRevision,
      templateHash: baseVisual.templateHash,
      from: runFrom,
      durationInFrames: runTo - runFrom,
      src: baseVisual.src,
      kind: "video",
      display: resolvedDisplay
    } as RenderVisualV25);
    runStart = index;
  }
  return segments;
}

function toV25Visual(
  assignment: z.infer<
    typeof videoProjectSchema
  >["visuals"]["assignments"][number],
  baseVisual: RenderVisualV24,
  baseLines: readonly RenderLineV24[],
  script: ReturnType<typeof playbackScriptForProject>,
  fps: number,
  assignmentIndex: number,
  baseCompilerInputHash: string,
  diagnostics: RenderManifestDiagnostic[]
): RenderVisualV25[] {
  if (baseVisual.kind === "video") {
    return buildV25VideoSegments(
      assignment,
      baseVisual,
      baseLines,
      script,
      fps,
      assignmentIndex,
      baseCompilerInputHash,
      diagnostics
    );
  }
  const startLine = baseLines.find(
    (line) => line.id === baseVisual.segmentStartLineId
  );
  return [
    {
      id: baseVisual.id,
      sourceAssignmentId: baseVisual.sourceAssignmentId,
      segmentIndex: baseVisual.segmentIndex,
      segmentStartLineId: baseVisual.segmentStartLineId,
      segmentEndLineId: baseVisual.segmentEndLineId,
      sectionId: startLine?.sectionId ?? assignment.startLineId,
      templateRevision: baseVisual.templateRevision,
      templateHash: baseVisual.templateHash,
      from: baseVisual.from,
      durationInFrames: baseVisual.durationInFrames,
      src: baseVisual.src,
      kind: baseVisual.kind,
      display: baseVisual.display
    } as RenderVisualV25
  ];
}

function successV25(
  manifest: RenderManifestV25,
  warnings: readonly RenderManifestWarning[]
): RenderManifestCompileSuccess<RenderManifestV25> {
  return {
    success: true,
    ok: true,
    manifest: orderedManifest(manifest),
    diagnostics: [],
    errors: [],
    warnings: warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

export function compileRenderManifestV25(
  input: RenderManifestCompilerInput,
  options: RenderManifestCompileOptions = {}
): RenderManifestCompileResult<RenderManifestV25> {
  const projectResult = videoProjectSchema.safeParse(
    input.project ?? input.videoProject
  );
  if (!projectResult.success) {
    return compileRenderManifestV24(
      input,
      options
    ) as RenderManifestCompileResult<RenderManifestV25>;
  }

  const diagnostics: RenderManifestDiagnostic[] = [];
  if (!validateV25PlaybackCues(projectResult.data, diagnostics)) {
    return failure(diagnostics);
  }

  const baseResult = compileRenderManifestV24(
    {
      ...input,
      project: projectWithoutPlaybackCues(projectResult.data)
    },
    options
  );
  if (!baseResult.success) {
    return baseResult as RenderManifestCompileResult<RenderManifestV25>;
  }

  const baseManifest = baseResult.manifest;
  const sectionLayouts = baseManifest.sectionLayouts;
  const layoutIntervals = v25LayoutIntervals(baseManifest);
  const playbackScript = playbackScriptForProject(projectResult.data);
  const assignmentById = new Map(
    projectResult.data.visuals.assignments.map((assignment) => [
      assignment.id,
      assignment
    ])
  );
  const visualValues = baseManifest.visuals.flatMap((baseVisual) => {
    const assignment = assignmentById.get(baseVisual.sourceAssignmentId);
    if (assignment === undefined) {
      return [];
    }
    return toV25Visual(
      assignment,
      baseVisual,
      baseManifest.lines,
      playbackScript,
      baseManifest.fps,
      projectResult.data.visuals.assignments.findIndex(
        (candidate) => candidate.id === assignment.id
      ),
      baseManifest.compilerInputHash,
      diagnostics
    );
  });

  if (diagnostics.length > 0) {
    return failure(diagnostics, baseResult.warnings);
  }

  const lines: RenderLine[] = baseManifest.lines.map((line) => ({
    id: line.id,
    sectionId: line.sectionId,
    from: line.from,
    durationInFrames: line.durationInFrames,
    speechFrom: line.speechFrom,
    speechDurationInFrames: line.speechDurationInFrames,
    audioPath: line.audioPath,
    subtitleText: line.subtitleText,
    speakerId: line.speakerId,
    expression: line.expression,
    characterVariantId: line.characterVariantId
  }));
  const sourceProjectHash = sha256CanonicalJson(projectResult.data);
  const compilerInputHash = sha256CanonicalJson({
    manifestVersion: RENDER_MANIFEST_V25_VERSION,
    baseCompilerInputHash: baseManifest.compilerInputHash,
    sourceProjectHash,
    sectionLayouts,
    layoutIntervals,
    project: projectResult.data,
    visualSegments: visualValues
  });
  const manifest = {
    ...baseManifest,
    manifestVersion: RENDER_MANIFEST_V25_VERSION,
    sourceProjectHash,
    compilerInputHash,
    sectionLayouts,
    layoutIntervals,
    lines,
    visuals: visualValues
  } satisfies RenderManifestV25;
  const manifestResult = renderManifestV25Schema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }
  return successV25(manifestResult.data, baseResult.warnings);
}

function glowColorsForCatalog(rawCatalog: unknown): Map<string, string> {
  const colors = new Map<string, string>();
  const snapshotResult =
    characterVisualCatalogSnapshotSchema.safeParse(rawCatalog);
  if (snapshotResult.success) {
    for (const visual of snapshotResult.data) {
      colors.set(visual.visualId, visual.glowColor);
    }
    return colors;
  }

  if (!Array.isArray(rawCatalog)) {
    return colors;
  }
  for (const rawEntry of rawCatalog) {
    if (!isPlainRecord(rawEntry)) {
      continue;
    }
    const visualId = rawEntry.visualId ?? rawEntry.characterId;
    const glowColor = rawEntry.glowColor ?? rawEntry.visualGlowColor;
    if (
      typeof visualId === "string" &&
      typeof glowColor === "string" &&
      !colors.has(visualId)
    ) {
      colors.set(visualId, glowColor);
    }
  }
  return colors;
}

function addDialogueWindowStyle(
  layout: ResolvedScreenLayout,
  template: ScreenTemplate | undefined
): ResolvedScreenLayoutV26 {
  const dialogueElement = template?.elements.find(
    (element) => element.type === "dialogue-window"
  );
  return {
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    elements: layout.elements.map((element): ResolvedScreenElementV26 => {
      if (element.type !== "dialogue-window") {
        return element;
      }
      return {
        ...element,
        backgroundColor:
          dialogueElement?.backgroundColor ??
          DEFAULT_DIALOGUE_WINDOW_BACKGROUND_COLOR,
        backgroundOpacity:
          dialogueElement?.backgroundOpacity ??
          DEFAULT_DIALOGUE_WINDOW_BACKGROUND_OPACITY
      };
    })
  };
}

function successV26(
  manifest: RenderManifestV26,
  warnings: readonly RenderManifestWarning[]
): RenderManifestCompileSuccess<RenderManifestV26> {
  return {
    success: true,
    ok: true,
    manifest: orderedManifestV26(manifest),
    diagnostics: [],
    errors: [],
    warnings: warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

export function compileRenderManifestV26(
  input: RenderManifestCompilerInput,
  options: RenderManifestCompileOptions = {}
): RenderManifestCompileResult<RenderManifestV26> {
  const baseResult = compileRenderManifestV25(input, options);
  if (!baseResult.success) {
    return baseResult as RenderManifestCompileResult<RenderManifestV26>;
  }

  const diagnostics: RenderManifestDiagnostic[] = [];
  const templates = normalizeScreenTemplates(
    recordInputScreenTemplates(input),
    diagnostics
  );
  if (diagnostics.length > 0) {
    return failure(diagnostics, baseResult.warnings);
  }

  const glowColors = glowColorsForCatalog(recordInputCatalog(input));
  const characters = baseResult.manifest.characters.map((character) => ({
    ...character,
    glowColor:
      glowColors.get(character.visualId) ?? DEFAULT_CHARACTER_VISUAL_GLOW_COLOR
  }));
  const currentTemplateHashById = new Map(
    [...templates.values()].map((binding) => [
      binding.templateId,
      binding.currentTemplateHash
    ])
  );
  const sectionLayouts = baseResult.manifest.sectionLayouts.map((layout) => ({
    ...layout,
    templateHash:
      currentTemplateHashById.get(layout.templateId) ?? layout.templateHash,
    resolvedLayout: addDialogueWindowStyle(
      layout.resolvedLayout,
      templates.get(layout.templateId)?.template
    )
  }));
  const templateIdBySectionId = new Map(
    baseResult.manifest.sectionLayouts.map((layout) => [
      layout.sectionId,
      layout.templateId
    ])
  );
  const layoutIntervals = baseResult.manifest.layoutIntervals.map(
    (interval) => {
      const templateId = templateIdBySectionId.get(interval.sectionId);
      return {
        ...interval,
        resolvedLayout: addDialogueWindowStyle(
          interval.resolvedLayout,
          templateId === undefined
            ? undefined
            : templates.get(templateId)?.template
        )
      };
    }
  );
  const currentTemplateHashBySectionId = new Map(
    sectionLayouts.map((layout) => [layout.sectionId, layout.templateHash])
  );
  const visuals = baseResult.manifest.visuals.map((visual) => ({
    ...visual,
    templateHash:
      currentTemplateHashBySectionId.get(visual.sectionId) ??
      visual.templateHash
  }));
  const compilerInputHash = sha256CanonicalJson({
    manifestVersion: RENDER_MANIFEST_V26_VERSION,
    baseCompilerInputHash: baseResult.manifest.compilerInputHash,
    glowColors: [...glowColors.entries()].sort(([left], [right]) =>
      compareStrings(left, right)
    ),
    sectionLayouts,
    layoutIntervals
  });
  const manifest = {
    ...baseResult.manifest,
    manifestVersion: RENDER_MANIFEST_V26_VERSION,
    compilerInputHash,
    characters,
    sectionLayouts,
    layoutIntervals,
    visuals
  } satisfies RenderManifestV26;
  const manifestResult = renderManifestV26Schema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }
  return successV26(manifestResult.data, baseResult.warnings);
}

function successV28(
  manifest: RenderManifestV28,
  warnings: readonly RenderManifestWarning[]
): RenderManifestCompileSuccess<RenderManifestV28> {
  return {
    success: true,
    ok: true,
    manifest: orderedManifestV28(manifest),
    diagnostics: [],
    errors: [],
    warnings: warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

export function compileRenderManifestV28(
  input: RenderManifestCompilerInput
): RenderManifestCompileResult<RenderManifestV28> {
  const baseResult = compileRenderManifestV26(input, {
    resolveEditVideoTiming: true
  });
  if (!baseResult.success) {
    return baseResult as RenderManifestCompileResult<RenderManifestV28>;
  }

  const projectResult = videoProjectSchema.safeParse(
    input.project ?? input.videoProject
  );
  if (!projectResult.success) {
    const diagnostics: RenderManifestDiagnostic[] = [];
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.videoProjectSchema,
      projectResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }

  const diagnostics: RenderManifestDiagnostic[] = [];
  const templates = normalizeInsertTextTemplates(
    recordInputInsertTextTemplates(input),
    diagnostics
  );
  const project = projectResult.data;
  const templateById = new Map(
    [...templates.values()].map((binding) => [
      binding.template.templateId,
      binding
    ])
  );
  const snapshotByElementId = new Map<string, RenderInsertTextSnapshot>();
  const dependencies = new Map<
    string,
    { readonly template: InsertTextTemplate; readonly templateHash: string }
  >();

  for (const [elementIndex, element] of project.edit.videoElements.entries()) {
    if (element.text.length === 0 || element.textTemplateId === null) {
      continue;
    }
    const binding = templateById.get(element.textTemplateId);
    if (binding === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.insertTextTemplateMissing,
        ["edit", "videoElements", elementIndex, "textTemplateId"],
        "selected insert text template does not exist",
        { assignmentId: element.id }
      );
      continue;
    }
    if (binding.template.status !== "active") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.insertTextTemplateInactive,
        ["edit", "videoElements", elementIndex, "textTemplateId"],
        "selected insert text template is inactive",
        { assignmentId: element.id }
      );
      continue;
    }
    const template = binding.template;
    snapshotByElementId.set(element.id, {
      templateId: template.templateId,
      templateRevision: template.revision,
      templateHash: binding.templateHash,
      text: element.text,
      resolvedTextLayout: {
        rect: template.textRect,
        rotationDeg: template.rotationDeg,
        fontSize: template.fontSize,
        fontWeight: template.fontWeight,
        textColor: template.textColor,
        textAlign: template.textAlign,
        verticalAlign: template.verticalAlign
      }
    });
    dependencies.set(template.templateId, binding);
  }

  if (diagnostics.length > 0) {
    return failure(diagnostics, baseResult.warnings);
  }

  const elementById = new Map(
    project.edit.videoElements.map((element) => [element.id, element])
  );
  const inserts: RenderInsertV28[] = baseResult.manifest.inserts.map(
    (insert) => {
      const element = elementById.get(insert.id);
      if (element === undefined) {
        throw new Error(`edit video element is missing: ${insert.id}`);
      }
      return {
        ...insert,
        startMs: element.startMs,
        playbackRate: element.playbackRate,
        text: snapshotByElementId.get(insert.id) ?? null
      };
    }
  );
  const dependencySnapshot = [...dependencies.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([templateId, binding]) => ({
      templateId,
      templateRevision: binding.template.revision,
      templateHash: binding.templateHash,
      resolvedTextLayout: {
        rect: binding.template.textRect,
        rotationDeg: binding.template.rotationDeg,
        fontSize: binding.template.fontSize,
        fontWeight: binding.template.fontWeight,
        textColor: binding.template.textColor,
        textAlign: binding.template.textAlign,
        verticalAlign: binding.template.verticalAlign
      }
    }));
  const compilerInputHash = sha256CanonicalJson({
    manifestVersion: RENDER_MANIFEST_V28_VERSION,
    baseCompilerInputHash: baseResult.manifest.compilerInputHash,
    insertTextTemplates: dependencySnapshot,
    inserts
  });
  const manifest = {
    ...baseResult.manifest,
    manifestVersion: RENDER_MANIFEST_V28_VERSION,
    compilerInputHash,
    inserts
  } satisfies RenderManifestV28;
  const manifestResult = renderManifestV28Schema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }
  return successV28(manifestResult.data, baseResult.warnings);
}

function resolveLineOverlays(
  project: ReturnType<typeof videoProjectSchema.parse>,
  manifest: RenderManifestV28,
  diagnostics: RenderManifestDiagnostic[]
): RenderLineOverlay[] {
  const lineOrder = new Map(
    manifest.lines.map((line, index) => [line.id, index] as const)
  );
  const resolved: Array<{ overlay: RenderLineOverlay; sourceIndex: number }> =
    [];

  for (const [
    sourceIndex,
    overlay
  ] of project.overlays.lineOverlays.entries()) {
    const line = manifest.lines.find(
      (candidate) => candidate.id === overlay.lineId
    );
    if (line === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.manifestSchema,
        ["overlays", "lineOverlays", sourceIndex, "lineId"],
        "line overlay lineId must reference a compiled line",
        { assignmentId: overlay.id }
      );
      continue;
    }

    resolved.push({
      sourceIndex,
      overlay: {
        id: overlay.id,
        lineId: overlay.lineId,
        from: line.from,
        durationInFrames: line.durationInFrames,
        kind: overlay.kind,
        resolvedTransform: {
          x: overlay.transform.x * manifest.width,
          y: overlay.transform.y * manifest.height,
          width: overlay.transform.width * manifest.width,
          height: overlay.transform.height * manifest.height,
          rotationDeg: overlay.transform.rotationDeg
        },
        colorToken: overlay.colorToken,
        text: overlay.text,
        animation: overlay.animation
      } as RenderLineOverlay
    });
  }

  return resolved
    .sort((left, right) => {
      const lineDifference =
        (lineOrder.get(left.overlay.lineId) ?? Number.MAX_SAFE_INTEGER) -
        (lineOrder.get(right.overlay.lineId) ?? Number.MAX_SAFE_INTEGER);
      return lineDifference !== 0
        ? lineDifference
        : left.sourceIndex - right.sourceIndex;
    })
    .map(({ overlay }) => overlay);
}

export function compileRenderManifestV29(
  input: RenderManifestCompilerInput
): RenderManifestCompileResult<RenderManifestV29> {
  const baseResult = compileRenderManifestV28(input);
  if (!baseResult.success) {
    return baseResult as RenderManifestCompileResult<RenderManifestV29>;
  }

  const projectResult = videoProjectSchema.safeParse(
    input.project ?? input.videoProject
  );
  if (!projectResult.success) {
    const diagnostics: RenderManifestDiagnostic[] = [];
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.videoProjectSchema,
      projectResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }

  const diagnostics: RenderManifestDiagnostic[] = [];
  const lineOverlays = resolveLineOverlays(
    projectResult.data,
    baseResult.manifest,
    diagnostics
  );
  if (diagnostics.length > 0) {
    return failure(diagnostics, baseResult.warnings);
  }

  const compilerInputHash = sha256CanonicalJson({
    manifestVersion: RENDER_MANIFEST_VERSION,
    baseCompilerInputHash: baseResult.manifest.compilerInputHash,
    lineOverlays
  });
  const manifest = {
    ...baseResult.manifest,
    manifestVersion: RENDER_MANIFEST_VERSION,
    compilerInputHash,
    lineOverlays
  } satisfies RenderManifestV29;
  const manifestResult = renderManifestV29Schema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics, baseResult.warnings);
  }
  return {
    success: true,
    ok: true,
    manifest: orderedManifestV29(manifestResult.data),
    diagnostics: [],
    errors: [],
    warnings: baseResult.warnings.map((warning) => ({
      ...warning,
      soundEffectIds: [...warning.soundEffectIds],
      lineIds: [...warning.lineIds]
    }))
  };
}

export function compileRenderManifest(
  input: RenderManifestCompilerInput
): RenderManifestCompileResult<RenderManifest> {
  return compileRenderManifestV29(
    input
  ) as RenderManifestCompileResult<RenderManifest>;
}

export class RenderManifestCompiler {
  compile(input: RenderManifestCompilerInput): RenderManifestCompileResult {
    return compileRenderManifest(input);
  }
}

export type { CharacterVariantMapping };
