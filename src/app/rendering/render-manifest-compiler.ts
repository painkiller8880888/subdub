import { createHash } from "node:crypto";
import { z } from "zod";

import {
  characterVariantCatalog as defaultCharacterVariantCatalog,
  characterVariantMapping as defaultCharacterVariantMapping,
  CHARACTER_VARIANT_CATALOG_VERSION,
  CHARACTER_VARIANT_MAPPING_VERSION,
  type CharacterVariantMapping,
  type CharacterVariantMappingExpression,
  type CharacterVariantRenderType
} from "../../assets/character-asset-manifest.js";
import { computeOutlineHash } from "../projects/script-domain.js";
import {
  calculateLineRanges,
  calculateSectionRanges,
  calculateVisualRanges,
  getEndExclusive,
  msToFrames,
  type TimelineLineRange
} from "../../timeline/index.js";
import {
  idSchema,
  relativePosixPathSchema,
  renderManifestSchema,
  sha256Schema,
  type RenderBackground,
  type RenderCharacter,
  type RenderCharacterVariant,
  type RenderLine,
  type RenderManifest,
  type RenderSoundEffect,
  type RenderVisual,
  videoProjectSchema
} from "../../schema/index.js";
import {
  voicevoxAudioIndexSchema,
  type VoicevoxAudioIndexEntry
} from "../voicevox/audio-index.js";

export const RENDER_MANIFEST_VERSION = "2.1.0" as const;

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
  audioExtra: "AUDIO_INDEX_ENTRY_EXTRA",
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
  assetPageCountMissing: "ASSET_PAGE_COUNT_MISSING",
  visualRangeInvalid: "VISUAL_RANGE_INVALID",
  fadeRangeInvalid: "AUDIO_FADE_RANGE_INVALID",
  mappingMissing: "CHARACTER_MAPPING_MISSING",
  variantMissing: "CHARACTER_VARIANT_MISSING",
  variantCharacterMismatch: "CHARACTER_VARIANT_CHARACTER_MISMATCH",
  variantFileSlotMissing: "CHARACTER_VARIANT_FILE_SLOT_MISSING",
  variantFileMissing: "CHARACTER_VARIANT_FILE_MISSING",
  variantFileKindMismatch: "CHARACTER_VARIANT_FILE_KIND_MISMATCH",
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
  readonly characterVariantMapping?: unknown;
  readonly mapping?: unknown;
  readonly characterCatalogVersion?: unknown;
  readonly characterMappingVersion?: unknown;
};

export type RenderManifestCompileSuccess = {
  readonly success: true;
  readonly ok: true;
  readonly manifest: RenderManifest;
  readonly diagnostics: readonly [];
  readonly errors: readonly [];
};

export type RenderManifestCompileFailure = {
  readonly success: false;
  readonly ok: false;
  readonly manifest: null;
  readonly diagnostics: readonly RenderManifestDiagnostic[];
  readonly errors: readonly RenderManifestDiagnostic[];
};

export type RenderManifestCompileResult =
  RenderManifestCompileSuccess | RenderManifestCompileFailure;

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
};

type NormalizedCatalogVariant = {
  readonly variantId: string;
  readonly characterId: string;
  readonly renderType: CharacterVariantRenderType;
  readonly files: ReadonlyMap<string, NormalizedCatalogFile>;
  readonly inputIndex: number;
};

type AssetLookup = ReadonlyMap<string, RenderManifestAssetMetadata>;

type LineEntry = {
  readonly sectionIndex: number;
  readonly sectionId: string;
  readonly lineIndex: number;
  readonly line: RenderProjectLine;
};

type RenderProjectLine = {
  readonly id: string;
  readonly speakerId: string;
  readonly spokenText: string;
  readonly subtitleText: string;
  readonly expression: "neutral" | "smile" | "explain" | "caution";
  readonly pauseBeforeMs: number;
  readonly pauseAfterMs: number;
};

type EyeCatchEntry = {
  readonly inputIndex: number;
  readonly id: string;
  readonly beforeSectionId: string;
  readonly sectionIndex: number;
  readonly label: string;
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

function recordInputAssets(input: RenderManifestCompilerInput): unknown {
  return input.assetMetadata ?? input.assets ?? input.materials ?? [];
}

function recordInputCatalog(input: RenderManifestCompilerInput): unknown {
  return (
    input.characterVariantCatalog ??
    input.catalog ??
    defaultCharacterVariantCatalog
  );
}

function recordInputMapping(input: RenderManifestCompilerInput): unknown {
  return (
    input.characterVariantMapping ??
    input.mapping ??
    defaultCharacterVariantMapping
  );
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

  const variants: NormalizedCatalogVariant[] = [];
  const variantIds = new Set<string>();

  for (const [index, rawVariant] of rawCatalog.entries()) {
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
    const characterId = rawVariant.characterId;
    const renderType = rawVariant.renderType;
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
    if (variantIds.has(variantId)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "variantId"],
        "variantId must be unique",
        { variantId }
      );
    }
    variantIds.add(variantId);

    if (
      typeof characterId !== "string" ||
      !idSchema.safeParse(characterId).success
    ) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "characterId"],
        "characterId must be a lower-kebab-case identifier",
        { variantId }
      );
      continue;
    }

    if (renderType !== "single-image" && renderType !== "mouth-pair") {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.catalogSchema,
        ["characterVariantCatalog", index, "renderType"],
        "renderType must be single-image or mouth-pair",
        { variantId, sectionId: characterId }
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
      files.set(key, { key, destinationPath });
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
      characterId,
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

function resolveMappingValue(
  rawMapping: unknown,
  characterId: string,
  expression: CharacterVariantMappingExpression
): string | undefined {
  if (!isPlainRecord(rawMapping)) {
    return undefined;
  }
  const characterMapping = rawMapping[characterId];
  if (!isPlainRecord(characterMapping)) {
    return undefined;
  }
  const variantId = characterMapping[expression];
  return typeof variantId === "string" && idSchema.safeParse(variantId).success
    ? variantId
    : undefined;
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
      "asset checksum does not match the project or audio index",
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
  variants: ReadonlyMap<string, NormalizedCatalogVariant>,
  variantId: string,
  characterId: string,
  diagnostics: RenderManifestDiagnostic[],
  context: DiagnosticContext
): NormalizedCatalogVariant | undefined {
  const variant = variants.get(variantId);
  if (variant === undefined) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.variantMissing,
      ["characterVariantCatalog", variantId],
      "mapped character variant is not present in characterVariantCatalog",
      { ...context, variantId }
    );
    return undefined;
  }
  if (variant.characterId !== characterId) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.variantCharacterMismatch,
      ["characterVariantCatalog", variant.inputIndex, "characterId"],
      "mapped character variant belongs to a different character",
      { ...context, variantId }
    );
  }
  return variant;
}

function shiftedFrom(
  from: number,
  sectionIndex: number,
  eyeCatchSectionIndices: readonly number[],
  openingFrames: number,
  eyeCatchFrames: number
): number {
  const eyeCatchCount = eyeCatchSectionIndices.filter(
    (index) => index <= sectionIndex
  ).length;
  return from + openingFrames + eyeCatchCount * eyeCatchFrames;
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

function orderedVisualDisplay(
  display: RenderVisual["display"]
): RenderVisual["display"] {
  if (display.kind === "video") {
    return {
      kind: display.kind,
      fit: display.fit,
      crop: display.crop,
      scale: display.scale,
      position: display.position,
      prioritizeVisual: display.prioritizeVisual,
      annotations: display.annotations,
      startMs: display.startMs,
      endMs: display.endMs,
      playbackRate: display.playbackRate,
      muted: display.muted
    };
  }
  if (display.kind === "photo") {
    return {
      kind: display.kind,
      fit: display.fit,
      crop: display.crop,
      scale: display.scale,
      position: display.position,
      prioritizeVisual: display.prioritizeVisual,
      annotations: display.annotations
    };
  }
  return {
    kind: display.kind,
    fit: display.fit,
    crop: display.crop,
    scale: display.scale,
    position: display.position,
    prioritizeVisual: display.prioritizeVisual,
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

function orderedManifest(manifest: RenderManifest): RenderManifest {
  return {
    manifestVersion: manifest.manifestVersion,
    sourceProjectHash: manifest.sourceProjectHash,
    compilerInputHash: manifest.compilerInputHash,
    characterCatalogVersion: manifest.characterCatalogVersion,
    characterMappingVersion: manifest.characterMappingVersion,
    characters: manifest.characters.map((character): RenderCharacter => ({
      characterId: character.characterId,
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
              characterId: variant.characterId,
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
              characterId: variant.characterId,
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
    visuals: manifest.visuals.map((visual): RenderVisual => {
      if (visual.kind === "video") {
        return {
          id: visual.id,
          from: visual.from,
          durationInFrames: visual.durationInFrames,
          src: visual.src,
          kind: visual.kind,
          display: orderedVisualDisplay(visual.display) as typeof visual.display
        };
      }
      if (visual.kind === "photo") {
        return {
          id: visual.id,
          from: visual.from,
          durationInFrames: visual.durationInFrames,
          src: visual.src,
          kind: visual.kind,
          display: orderedVisualDisplay(visual.display) as typeof visual.display
        };
      }
      return {
        id: visual.id,
        from: visual.from,
        durationInFrames: visual.durationInFrames,
        src: visual.src,
        kind: visual.kind,
        display: orderedVisualDisplay(visual.display) as typeof visual.display
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
      loop: track.loop,
      fadeInFrames: track.fadeInFrames,
      fadeOutFrames: track.fadeOutFrames
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
    inserts: manifest.inserts.map((insert) => ({
      id: insert.id,
      kind: insert.kind,
      slot: insert.slot,
      beforeSectionId: insert.beforeSectionId,
      from: insert.from,
      durationInFrames: insert.durationInFrames,
      label: insert.label
    }))
  };
}

export function serializeRenderManifest(manifest: unknown): string {
  const parsed = renderManifestSchema.parse(manifest);
  return `${JSON.stringify(orderedManifest(parsed), null, 2)}\n`;
}

function failure(
  diagnostics: readonly RenderManifestDiagnostic[]
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
    errors: copied
  };
}

function success(manifest: RenderManifest): RenderManifestCompileSuccess {
  return {
    success: true,
    ok: true,
    manifest: orderedManifest(manifest),
    diagnostics: [],
    errors: []
  };
}

export function compileRenderManifest(
  input: RenderManifestCompilerInput
): RenderManifestCompileResult {
  const diagnostics: RenderManifestDiagnostic[] = [];
  const projectRaw = input.project ?? input.videoProject;
  const audioRaw = input.audioIndex ?? input.audio;
  const projectResult = videoProjectSchema.safeParse(projectRaw);
  const audioResult = voicevoxAudioIndexSchema.safeParse(audioRaw);
  const assets = normalizeAssets(recordInputAssets(input), diagnostics);
  const assetLookup = getAssetLookup(assets);
  const catalog = normalizeCatalog(recordInputCatalog(input), diagnostics);
  const catalogById = new Map(
    catalog.map((variant) => [variant.variantId, variant])
  );
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
  const audioIndex = audioResult.data;
  const sourceProjectHash = sha256CanonicalJson(project);

  if (project.outline.status !== "approved") {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.outlineNotApproved,
      ["outline", "status"],
      "outline must be approved before manifest compilation"
    );
  }
  if (project.script.status !== "approved") {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.scriptNotApproved,
      ["script", "status"],
      "script must be approved before manifest compilation"
    );
  }
  if (project.visuals.status !== "approved") {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.visualsNotApproved,
      ["visuals", "status"],
      "visual plan must be approved before manifest compilation"
    );
  }
  if (project.outline.sourceHash !== project.source.sha256) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.outlineStale,
      ["outline", "sourceHash"],
      "outline sourceHash does not match project.source.sha256"
    );
  }
  if (computeOutlineHash(project.outline) !== project.script.outlineHash) {
    addDiagnostic(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.scriptStale,
      ["script", "outlineHash"],
      "script outlineHash does not match the current outline"
    );
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
  const lineIds = new Set(lineEntries.map(({ line }) => line.id));
  const lineIndexById = new Map(
    lineEntries.map((entry) => [entry.line.id, entry])
  );
  const sourceAssets = new Map<string, string>();
  const lineAudio = new Map<string, VoicevoxAudioIndexEntry>();
  for (const entry of lineEntries) {
    const audioEntry = audioIndex[entry.line.id];
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
  for (const [lineId, entry] of Object.entries(audioIndex)) {
    if (!lineIds.has(lineId)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.audioExtra,
        ["audioIndex", lineId],
        "audio index contains an entry for a deleted or unknown line",
        { lineId }
      );
      void entry;
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

  for (const [bgmIndex, bgm] of project.audio.sectionBgms.entries()) {
    const asset = requireAsset(
      assetLookup,
      bgm.path,
      ["audio", "bgm"],
      diagnostics,
      ["audio", "sectionBgms", bgmIndex, "path"],
      { sectionId: bgm.sectionId, assetPath: bgm.path },
      undefined,
      true
    );
    if (asset !== undefined) {
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

  const mapping = recordInputMapping(input);
  const idleVariantIds = new Map<string, string>();
  const lineVariantIds = new Map<string, string>();
  const referencedVariantIds = new Set<string>();
  for (const character of project.characters) {
    const idleVariantId = resolveMappingValue(mapping, character.id, "idle");
    if (idleVariantId === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.mappingMissing,
        ["characterVariantMapping", character.id, "idle"],
        "explicit idle mapping is required for every project character",
        { sectionId: character.id }
      );
    } else {
      idleVariantIds.set(character.id, idleVariantId);
      referencedVariantIds.add(idleVariantId);
      variantForId(catalogById, idleVariantId, character.id, diagnostics, {
        sectionId: character.id,
        variantId: idleVariantId
      });
    }
  }
  for (const entry of lineEntries) {
    const variantId = resolveMappingValue(
      mapping,
      entry.line.speakerId,
      entry.line.expression
    );
    if (variantId === undefined) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.mappingMissing,
        [
          "characterVariantMapping",
          entry.line.speakerId,
          entry.line.expression
        ],
        "explicit logical-expression mapping is required for every script line",
        { lineId: entry.line.id, sectionId: entry.sectionId }
      );
      continue;
    }
    lineVariantIds.set(entry.line.id, variantId);
    referencedVariantIds.add(variantId);
    variantForId(catalogById, variantId, entry.line.speakerId, diagnostics, {
      lineId: entry.line.id,
      sectionId: entry.sectionId,
      variantId
    });
  }

  const resolvedCharacterVariants = new Map<string, RenderCharacterVariant>();
  for (const variantId of [...referencedVariantIds].sort()) {
    const catalogVariant = catalogById.get(variantId);
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
        { variantId, assetPath: file.destinationPath }
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
        resolvedCharacterVariants.set(variantId, {
          variantId,
          characterId: catalogVariant.characterId,
          renderType: "single-image",
          files: { single }
        });
      }
    } else {
      const closed = resolvedFiles.closed;
      const open = resolvedFiles.open;
      if (closed !== undefined && open !== undefined) {
        resolvedCharacterVariants.set(variantId, {
          variantId,
          characterId: catalogVariant.characterId,
          renderType: "mouth-pair",
          files: { closed, open }
        });
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

    const sectionRangeBySectionId = new Map(
      sectionRanges.map((range) => [range.sectionId, range])
    );
    for (const [bgmIndex, bgm] of project.audio.sectionBgms.entries()) {
      const sectionRange = sectionRangeBySectionId.get(bgm.sectionId);
      if (sectionRange === undefined) {
        continue;
      }
      const fadeInFrames = msToFrames(
        bgm.fadeInMs,
        project.metadata.outputSettings.fps
      );
      const fadeOutFrames = msToFrames(
        bgm.fadeOutMs,
        project.metadata.outputSettings.fps
      );
      if (
        fadeInFrames > sectionRange.durationInFrames ||
        fadeOutFrames > sectionRange.durationInFrames
      ) {
        addDiagnostic(
          diagnostics,
          RENDER_MANIFEST_ERROR_CODE.fadeRangeInvalid,
          ["audio", "sectionBgms", bgmIndex],
          "BGM fade must fit within the section timeline",
          { sectionId: bgm.sectionId }
        );
      }
    }

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

  const sectionIndexById = new Map(
    project.script.sections.map((section, index) => [section.id, index])
  );
  const eyeCatches: EyeCatchEntry[] = [];
  const seenEyeCatchSections = new Set<string>();
  for (const [inputIndex, eyeCatch] of project.inserts.eyeCatches.entries()) {
    const sectionIndex = sectionIndexById.get(eyeCatch.beforeSectionId);
    if (sectionIndex === undefined) {
      continue;
    }
    if (seenEyeCatchSections.has(eyeCatch.beforeSectionId)) {
      addDiagnostic(
        diagnostics,
        RENDER_MANIFEST_ERROR_CODE.visualRangeInvalid,
        ["inserts", "eyeCatches", inputIndex, "beforeSectionId"],
        "at most one eye catch may be placed before a section",
        { sectionId: eyeCatch.beforeSectionId }
      );
    }
    seenEyeCatchSections.add(eyeCatch.beforeSectionId);
    eyeCatches.push({
      inputIndex,
      id: eyeCatch.id,
      beforeSectionId: eyeCatch.beforeSectionId,
      sectionIndex,
      label: eyeCatch.beforeSectionId
    });
  }
  eyeCatches.sort((left, right) => {
    const sectionDifference = left.sectionIndex - right.sectionIndex;
    return sectionDifference === 0
      ? left.inputIndex - right.inputIndex
      : sectionDifference;
  });

  if (
    diagnostics.length > 0 ||
    lineRanges === undefined ||
    sectionRanges === undefined ||
    visualRanges === undefined
  ) {
    return failure(diagnostics);
  }

  const fps = project.metadata.outputSettings.fps;
  const openingFrames = msToFrames(project.inserts.opening.durationMs, fps);
  const endingFrames = msToFrames(project.inserts.ending.durationMs, fps);
  const eyeCatchFrames =
    eyeCatches.length > 0
      ? msToFrames(project.inserts.eyeCatches[0]?.durationMs ?? 2000, fps)
      : msToFrames(2000, fps);
  const eyeCatchSectionIndices = eyeCatches.map(
    ({ sectionIndex }) => sectionIndex
  );
  const sectionRangeById = new Map(
    sectionRanges.map((range) => [range.sectionId, range])
  );
  const lineRangeById = new Map(lineRanges.map((range) => [range.id, range]));

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
      ...(asset.pageCount === undefined ? {} : { pageCount: asset.pageCount })
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
  const catalogForHash = catalog.map((variant) => ({
    variantId: variant.variantId,
    characterId: variant.characterId,
    renderType: variant.renderType,
    files: [...variant.files.values()]
      .sort((left, right) => compareStrings(left.key, right.key))
      .map((file) => ({ key: file.key, destinationPath: file.destinationPath }))
  }));
  const mappingForHash = project.characters.map((character) => ({
    characterId: character.id,
    idle: resolveMappingValue(mapping, character.id, "idle"),
    neutral: resolveMappingValue(mapping, character.id, "neutral"),
    smile: resolveMappingValue(mapping, character.id, "smile"),
    explain: resolveMappingValue(mapping, character.id, "explain"),
    caution: resolveMappingValue(mapping, character.id, "caution")
  }));
  const compilerInputHash = computeCompilerInputHash({
    project,
    audioIndex,
    assets: normalizedAssetsForHash,
    characterCatalogVersion,
    characterMappingVersion,
    characterCatalog: catalogForHash,
    characterMapping: mappingForHash
  });

  const renderLines: RenderLine[] = lineEntries.map((entry) => {
    const baseRange = lineRangeById.get(entry.line.id);
    if (baseRange === undefined) {
      throw new Error(`line range is missing: ${entry.line.id}`);
    }
    const from = shiftedFrom(
      baseRange.from,
      entry.sectionIndex,
      eyeCatchSectionIndices,
      openingFrames,
      eyeCatchFrames
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
      characterVariantId
    };
  });

  const assignmentById = new Map(
    project.visuals.assignments.map((assignment) => [assignment.id, assignment])
  );
  const visualValues = visualRanges.map((range) => {
    const assignment = assignmentById.get(range.id);
    if (assignment === undefined) {
      throw new Error(`visual assignment is missing: ${range.id}`);
    }
    const sectionIndex = lineIndexById.get(
      assignment.startLineId
    )?.sectionIndex;
    if (sectionIndex === undefined) {
      throw new Error(`visual assignment section is missing: ${assignment.id}`);
    }
    return {
      id: assignment.id,
      from: shiftedFrom(
        range.from,
        sectionIndex,
        eyeCatchSectionIndices,
        openingFrames,
        eyeCatchFrames
      ),
      durationInFrames: range.durationInFrames,
      kind: assignment.display.kind,
      src: assignment.projectMediaPath,
      display: assignment.display
    } as RenderVisual;
  });

  const renderBackgrounds = project.script.sections.map((section) => {
    const range = sectionRangeById.get(section.id);
    const sectionIndex = sectionIndexById.get(section.id);
    if (range === undefined || sectionIndex === undefined) {
      throw new Error(`section range is missing: ${section.id}`);
    }
    return {
      sectionId: section.id,
      from: shiftedFrom(
        range.from,
        sectionIndex,
        eyeCatchSectionIndices,
        openingFrames,
        eyeCatchFrames
      ),
      durationInFrames: range.durationInFrames,
      background: section.background
    } satisfies RenderBackground;
  });

  const renderAudioTracks = stableTimelineSort(
    project.audio.sectionBgms.map((bgm, inputIndex) => {
      const range = sectionRangeById.get(bgm.sectionId);
      const sectionIndex = sectionIndexById.get(bgm.sectionId);
      if (range === undefined || sectionIndex === undefined) {
        throw new Error(`BGM section range is missing: ${bgm.sectionId}`);
      }
      return {
        inputIndex,
        value: {
          id: bgm.id,
          sectionId: bgm.sectionId,
          from: shiftedFrom(
            range.from,
            sectionIndex,
            eyeCatchSectionIndices,
            openingFrames,
            eyeCatchFrames
          ),
          durationInFrames: range.durationInFrames,
          src: bgm.path,
          volume: bgm.volume,
          loop: bgm.loop,
          fadeInFrames: msToFrames(bgm.fadeInMs, fps),
          fadeOutFrames: msToFrames(bgm.fadeOutMs, fps)
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
          lineEntry.sectionIndex,
          eyeCatchSectionIndices,
          openingFrames,
          eyeCatchFrames
        ) +
        lineRange.speechFrom +
        msToFrames(effect.offsetMs, fps);
      if (
        from + durationInFrames >
        shiftedFrom(
          lineRange.from,
          lineEntry.sectionIndex,
          eyeCatchSectionIndices,
          openingFrames,
          eyeCatchFrames
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

  const renderInserts = [
    {
      id: project.inserts.opening.id,
      kind: "placeholder" as const,
      slot: "opening" as const,
      beforeSectionId: null,
      from: 0,
      durationInFrames: openingFrames,
      label: "opening"
    },
    ...eyeCatches.map((eyeCatch) => {
      const range = sectionRangeById.get(eyeCatch.beforeSectionId);
      if (range === undefined) {
        throw new Error(
          `eye catch section range is missing: ${eyeCatch.beforeSectionId}`
        );
      }
      const previousEyeCatchCount = eyeCatches.filter(
        (candidate) => candidate.sectionIndex < eyeCatch.sectionIndex
      ).length;
      return {
        id: eyeCatch.id,
        kind: "placeholder" as const,
        slot: "eye_catch" as const,
        beforeSectionId: eyeCatch.beforeSectionId,
        from:
          range.from + openingFrames + previousEyeCatchCount * eyeCatchFrames,
        durationInFrames: eyeCatchFrames,
        label: eyeCatch.label
      };
    }),
    {
      id: project.inserts.ending.id,
      kind: "placeholder" as const,
      slot: "ending" as const,
      beforeSectionId: null,
      from:
        getEndExclusive(
          lineRanges[lineRanges.length - 1] ?? { from: 0, durationInFrames: 0 }
        ) +
        openingFrames +
        eyeCatches.length * eyeCatchFrames,
      durationInFrames: endingFrames,
      label: "ending"
    }
  ];
  const durationInFrames =
    (renderInserts[renderInserts.length - 1]?.from ?? 0) + endingFrames;

  const characters: RenderCharacter[] = project.characters.map((character) => {
    const idleVariantId = idleVariantIds.get(character.id);
    if (idleVariantId === undefined) {
      throw new Error(`idle variant is missing: ${character.id}`);
    }
    return {
      characterId: character.id,
      displayName: character.name,
      themeColorToken: character.themeColorToken,
      lipSyncPeriodFrames: character.lipSyncPeriodFrames,
      idleVariantId
    };
  });
  const characterVariants = [...resolvedCharacterVariants.values()].sort(
    (left, right) => compareStrings(left.variantId, right.variantId)
  );
  const manifest = {
    manifestVersion: RENDER_MANIFEST_VERSION,
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
    lines: renderLines,
    visuals: visualValues,
    backgrounds: renderBackgrounds,
    audioTracks: renderAudioTracks,
    soundEffects: renderSoundEffects,
    inserts: renderInserts
  };
  const manifestResult = renderManifestSchema.safeParse(manifest);
  if (!manifestResult.success) {
    addZodDiagnostics(
      diagnostics,
      RENDER_MANIFEST_ERROR_CODE.manifestSchema,
      manifestResult.error,
      []
    );
    return failure(diagnostics);
  }
  if (diagnostics.length > 0) {
    return failure(diagnostics);
  }
  return success(manifestResult.data);
}

export class RenderManifestCompiler {
  compile(input: RenderManifestCompilerInput): RenderManifestCompileResult {
    return compileRenderManifest(input);
  }
}

export type { CharacterVariantMapping };
