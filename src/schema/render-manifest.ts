import { z } from "zod";

import {
  backgroundDefinitionSchema,
  cropSchema,
  documentDisplaySchema,
  expressionSchema,
  fitSchema,
  imageDisplaySchema,
  positionSchema,
  staticAnnotationSchema
} from "./common.js";
import {
  idSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  positiveNumberSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject,
  unitIntervalSchema
} from "./primitives.js";

export const sourceAssetChecksumSchema = strictObject({
  path: relativePosixPathSchema,
  sha256: sha256Schema
});

export const renderLineSchema = strictObject({
  id: idSchema,
  sectionId: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  speechFrom: nonNegativeIntegerSchema,
  speechDurationInFrames: positiveIntegerSchema,
  audioPath: relativePosixPathSchema,
  subtitleText: z.string(),
  speakerId: idSchema,
  expression: expressionSchema,
  characterVariantId: idSchema
});

const renderCharacterFileSchema = strictObject({
  path: relativePosixPathSchema,
  sha256: sha256Schema
});

const renderSingleImageFilesSchema = strictObject({
  single: renderCharacterFileSchema
});

const renderMouthPairFilesSchema = strictObject({
  closed: renderCharacterFileSchema,
  open: renderCharacterFileSchema
});

export const renderCharacterSchema = strictObject({
  characterId: idSchema,
  visualId: idSchema,
  displayName: z.string(),
  themeColorToken: z.enum(["character.metan", "character.zundamon"]),
  lipSyncPeriodFrames: positiveIntegerSchema,
  idleVariantId: idSchema
});

export const renderSingleImageCharacterVariantSchema = strictObject({
  variantId: idSchema,
  visualId: idSchema,
  renderType: z.literal("single-image"),
  files: renderSingleImageFilesSchema
});

export const renderMouthPairCharacterVariantSchema = strictObject({
  variantId: idSchema,
  visualId: idSchema,
  renderType: z.literal("mouth-pair"),
  files: renderMouthPairFilesSchema
});

export const renderCharacterVariantSchema = z.discriminatedUnion(
  "renderType",
  [
    renderSingleImageCharacterVariantSchema,
    renderMouthPairCharacterVariantSchema
  ]
);

/** Frozen RenderManifest 2.2.0 video display contract. */
export const legacyRenderVideoDisplayV22Schema = strictObject({
  kind: z.literal("video"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  startMs: nonNegativeIntegerSchema,
  endMs: nonNegativeIntegerSchema,
  playbackRate: positiveNumberSchema,
  muted: z.boolean()
}).superRefine((display, ctx) => {
  if (display.endMs <= display.startMs) {
    ctx.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "endMs must be greater than startMs"
    });
  }
});

/** RenderManifest 2.3.0 resolves the project volume without a legacy adapter. */
export const renderVideoDisplayV23Schema = strictObject({
  kind: z.literal("video"),
  fit: fitSchema,
  crop: cropSchema,
  scale: positiveNumberSchema,
  position: positionSchema,
  prioritizeVisual: z.boolean(),
  annotations: z.array(staticAnnotationSchema),
  startMs: nonNegativeIntegerSchema,
  endMs: nonNegativeIntegerSchema,
  playbackRate: positiveNumberSchema,
  volume: unitIntervalSchema
}).superRefine((display, ctx) => {
  if (display.endMs <= display.startMs) {
    ctx.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "endMs must be greater than startMs"
    });
  }
});

const renderVisualFields = {
  id: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  src: relativePosixPathSchema
};

export const renderVideoSchema = strictObject({
  ...renderVisualFields,
  kind: z.literal("video"),
  display: renderVideoDisplayV23Schema
});

const legacyRenderVideoSchema = strictObject({
  ...renderVisualFields,
  kind: z.literal("video"),
  display: legacyRenderVideoDisplayV22Schema
});

export const renderPhotoSchema = strictObject({
  ...renderVisualFields,
  kind: z.literal("photo"),
  display: imageDisplaySchema
});

export const renderDocumentScanSchema = strictObject({
  ...renderVisualFields,
  kind: z.literal("document_scan"),
  display: documentDisplaySchema
});

export const renderVisualSchema = z.discriminatedUnion("kind", [
  renderVideoSchema,
  renderPhotoSchema,
  renderDocumentScanSchema
]);

const legacyRenderVisualSchema = z.discriminatedUnion("kind", [
  legacyRenderVideoSchema,
  renderPhotoSchema,
  renderDocumentScanSchema
]);

export const renderBackgroundSchema = strictObject({
  sectionId: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  background: backgroundDefinitionSchema
});

export const renderAudioTrackSchema = strictObject({
  id: idSchema,
  sectionId: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  src: relativePosixPathSchema,
  volume: unitIntervalSchema,
  loop: z.literal(true),
});

const legacyRenderAudioTrackSchema = strictObject({
  id: idSchema,
  sectionId: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  src: relativePosixPathSchema,
  volume: unitIntervalSchema,
  loop: z.boolean(),
  fadeInFrames: nonNegativeIntegerSchema,
  fadeOutFrames: nonNegativeIntegerSchema
});

export const renderSoundEffectSchema = strictObject({
  id: idSchema,
  lineId: idSchema,
  category: z.enum(["confirm", "attention", "warning"]),
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  src: relativePosixPathSchema,
  volume: unitIntervalSchema
});

/** A resolved production video insert in RenderManifest 2.3.0. */
export const renderInsertSchema = strictObject({
  id: idSchema,
  role: z.enum(["intro", "outro", "cutin"]),
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  src: relativePosixPathSchema,
  volume: unitIntervalSchema
});
export const renderVideoInsertSchema = renderInsertSchema;

const renderManifestBaseSchema = strictObject({
  manifestVersion: z.literal("2.3.0"),
  sourceProjectHash: sha256Schema,
  compilerInputHash: sha256Schema,
  characterCatalogVersion: z.string().min(1),
  // Kept for existing cache and run-log consumers. In 2.2.0 this is
  // compatibility metadata only; it does not drive physical variant choice.
  characterMappingVersion: z.string().min(1),
  characters: z.array(renderCharacterSchema),
  characterVariants: z.array(renderCharacterVariantSchema),
  sourceAssetChecksums: z.array(sourceAssetChecksumSchema),
  fps: positiveIntegerSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  lines: z.array(renderLineSchema),
  visuals: z.array(renderVisualSchema),
  backgrounds: z.array(renderBackgroundSchema),
  audioTracks: z.array(renderAudioTrackSchema),
  soundEffects: z.array(renderSoundEffectSchema),
  inserts: z.array(renderInsertSchema)
});

/**
 * Explicit legacy parser boundary. It is intentionally not used by the
 * current compiler, API, or cache; old 2.2.0 files must be recompiled.
 */
export const legacyRenderInsertV22Schema = strictObject({
  id: idSchema,
  kind: z.literal("placeholder"),
  slot: z.enum(["opening", "ending", "eye_catch"]),
  beforeSectionId: idSchema.nullable(),
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  label: z.string()
});

const legacyRenderManifestBaseSchema = strictObject({
  manifestVersion: z.literal("2.2.0"),
  sourceProjectHash: sha256Schema,
  compilerInputHash: sha256Schema,
  characterCatalogVersion: z.string().min(1),
  characterMappingVersion: z.string().min(1),
  characters: z.array(renderCharacterSchema),
  characterVariants: z.array(renderCharacterVariantSchema),
  sourceAssetChecksums: z.array(sourceAssetChecksumSchema),
  fps: positiveIntegerSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  lines: z.array(renderLineSchema),
  visuals: z.array(legacyRenderVisualSchema),
  backgrounds: z.array(renderBackgroundSchema),
  audioTracks: z.array(legacyRenderAudioTrackSchema),
  soundEffects: z.array(renderSoundEffectSchema),
  inserts: z.array(legacyRenderInsertV22Schema)
});

export const legacyRenderManifestV22Schema = legacyRenderManifestBaseSchema;

type IssuePath = Array<string | number>;

function addDuplicateIssues(
  entries: ReadonlyArray<{ value: string; path: IssuePath }>,
  ctx: z.RefinementCtx,
  label: string
): void {
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.value)) {
      ctx.addIssue({
        code: "custom",
        path: entry.path,
        message: `${label} must be unique`
      });
    } else {
      seen.add(entry.value);
    }
  }
}

function addIssue(
  ctx: z.RefinementCtx,
  path: IssuePath,
  message: string
): void {
  ctx.addIssue({ code: "custom", path, message });
}

function renderVariantKey(visualId: string, variantId: string): string {
  return `${visualId}\u0000${variantId}`;
}

function validateTimelineOrder(
  items: ReadonlyArray<{ from: number }>,
  pathRoot: string,
  ctx: z.RefinementCtx
): void {
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].from < items[index - 1].from) {
      addIssue(
        ctx,
        [pathRoot, index, "from"],
        "timeline items must be ordered by ascending from"
      );
    }
  }
}

function validateTimelineNoOverlap(
  items: ReadonlyArray<{ from: number; durationInFrames: number }>,
  pathRoot: string,
  ctx: z.RefinementCtx
): void {
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (current.from < previous.from + previous.durationInFrames) {
      addIssue(
        ctx,
        [pathRoot, index, "from"],
        "timeline intervals must not overlap"
      );
    }
  }
}

function validateTimelineBounds(
  items: ReadonlyArray<{ from: number; durationInFrames: number }>,
  pathRoot: string,
  rootDuration: number,
  ctx: z.RefinementCtx
): void {
  for (const [index, item] of items.entries()) {
    if (item.from + item.durationInFrames > rootDuration) {
      addIssue(
        ctx,
        [pathRoot, index, "durationInFrames"],
        "timeline interval must fit within durationInFrames"
      );
    }
  }
}

export const renderManifestSchema = renderManifestBaseSchema.superRefine(
  (manifest, ctx) => {
    addDuplicateIssues(
      manifest.sourceAssetChecksums.map((asset, index) => ({
        value: asset.path,
        path: ["sourceAssetChecksums", index, "path"]
      })),
      ctx,
      "source asset path"
    );

    addDuplicateIssues(
      manifest.characters.map((character, index) => ({
        value: character.characterId,
        path: ["characters", index, "characterId"]
      })),
      ctx,
      "render character id"
    );
    addDuplicateIssues(
      manifest.characterVariants.map((variant, index) => ({
        value: renderVariantKey(variant.visualId, variant.variantId),
        path: ["characterVariants", index, "variantId"]
      })),
      ctx,
      "render character variant visualId/variantId"
    );

    addDuplicateIssues(
      manifest.lines.map((line, index) => ({
        value: line.id,
        path: ["lines", index, "id"]
      })),
      ctx,
      "render line id"
    );
    addDuplicateIssues(
      manifest.visuals.map((visual, index) => ({
        value: visual.id,
        path: ["visuals", index, "id"]
      })),
      ctx,
      "render visual id"
    );
    addDuplicateIssues(
      manifest.audioTracks.map((track, index) => ({
        value: track.id,
        path: ["audioTracks", index, "id"]
      })),
      ctx,
      "render audio track id"
    );
    addDuplicateIssues(
      manifest.soundEffects.map((effect, index) => ({
        value: effect.id,
        path: ["soundEffects", index, "id"]
      })),
      ctx,
      "render sound effect id"
    );
    addDuplicateIssues(
      manifest.inserts.map((insert, index) => ({
        value: insert.id,
        path: ["inserts", index, "id"]
      })),
      ctx,
      "render insert id"
    );

    validateTimelineOrder(manifest.lines, "lines", ctx);
    validateTimelineOrder(manifest.visuals, "visuals", ctx);
    validateTimelineOrder(manifest.backgrounds, "backgrounds", ctx);
    validateTimelineOrder(manifest.audioTracks, "audioTracks", ctx);
    validateTimelineOrder(manifest.soundEffects, "soundEffects", ctx);
    validateTimelineOrder(manifest.inserts, "inserts", ctx);
    validateTimelineNoOverlap(manifest.lines, "lines", ctx);
    validateTimelineNoOverlap(manifest.inserts, "inserts", ctx);

    validateTimelineBounds(
      manifest.lines,
      "lines",
      manifest.durationInFrames,
      ctx
    );
    validateTimelineBounds(
      manifest.visuals,
      "visuals",
      manifest.durationInFrames,
      ctx
    );
    validateTimelineBounds(
      manifest.backgrounds,
      "backgrounds",
      manifest.durationInFrames,
      ctx
    );
    validateTimelineBounds(
      manifest.audioTracks,
      "audioTracks",
      manifest.durationInFrames,
      ctx
    );
    validateTimelineBounds(
      manifest.soundEffects,
      "soundEffects",
      manifest.durationInFrames,
      ctx
    );
    validateTimelineBounds(
      manifest.inserts,
      "inserts",
      manifest.durationInFrames,
      ctx
    );

    for (const [audioIndex, track] of manifest.audioTracks.entries()) {
      for (const [insertIndex, insert] of manifest.inserts.entries()) {
        if (
          track.from < insert.from + insert.durationInFrames &&
          insert.from < track.from + track.durationInFrames
        ) {
          addIssue(
            ctx,
            ["audioTracks", audioIndex, "from"],
            `audio track must not overlap video insert at index ${insertIndex}`
          );
        }
      }
    }

    const lineById = new Map<string, (typeof manifest.lines)[number]>();
    const sectionIds = new Set<string>();
    const characterById = new Map<
      string,
      (typeof manifest.characters)[number]
    >();
    const variantByKey = new Map<
      string,
      (typeof manifest.characterVariants)[number]
    >();

    for (const character of manifest.characters) {
      if (!characterById.has(character.characterId)) {
        characterById.set(character.characterId, character);
      }
    }

    for (const [index, variant] of manifest.characterVariants.entries()) {
      const key = renderVariantKey(variant.visualId, variant.variantId);
      if (!variantByKey.has(key)) {
        variantByKey.set(key, variant);
      }
      if (
        !manifest.characters.some(
          (character) => character.visualId === variant.visualId
        )
      ) {
        addIssue(
          ctx,
          ["characterVariants", index, "visualId"],
          "character variant visualId must reference a render character visual"
        );
      }
    }

    for (const [index, character] of manifest.characters.entries()) {
      const idleVariant = variantByKey.get(
        renderVariantKey(character.visualId, character.idleVariantId)
      );
      if (idleVariant === undefined) {
        addIssue(
          ctx,
          ["characters", index, "idleVariantId"],
          "idleVariantId must reference a variant in the character visual"
        );
      }
    }

    for (const [index, line] of manifest.lines.entries()) {
      if (!lineById.has(line.id)) {
        lineById.set(line.id, line);
      }
      sectionIds.add(line.sectionId);

      if (
        line.speechFrom + line.speechDurationInFrames >
        line.durationInFrames
      ) {
        addIssue(
          ctx,
          ["lines", index, "speechDurationInFrames"],
          "speech interval must fit within the line interval"
        );
      }

      const speaker = characterById.get(line.speakerId);
      if (speaker === undefined) {
        addIssue(
          ctx,
          ["lines", index, "speakerId"],
          "speakerId must reference a render character"
        );
      }
      const variant =
        speaker === undefined
          ? undefined
          : variantByKey.get(
              renderVariantKey(speaker.visualId, line.characterVariantId)
            );
      if (variant === undefined) {
        addIssue(
          ctx,
          ["lines", index, "characterVariantId"],
          "characterVariantId must reference a variant in the speaker visual"
        );
      }
    }

    const seenBackgroundSections = new Set<string>();
    for (const [index, background] of manifest.backgrounds.entries()) {
      if (!sectionIds.has(background.sectionId)) {
        addIssue(
          ctx,
          ["backgrounds", index, "sectionId"],
          "background sectionId must reference a section present in lines"
        );
      }
      if (seenBackgroundSections.has(background.sectionId)) {
        addIssue(
          ctx,
          ["backgrounds", index, "sectionId"],
          "a section can have at most one background"
        );
      } else {
        seenBackgroundSections.add(background.sectionId);
      }
    }

    const seenAudioSections = new Set<string>();
    for (const [index, track] of manifest.audioTracks.entries()) {
      if (!sectionIds.has(track.sectionId)) {
        addIssue(
          ctx,
          ["audioTracks", index, "sectionId"],
          "audio track sectionId must reference a section present in lines"
        );
      }
      if (seenAudioSections.has(track.sectionId)) {
        addIssue(
          ctx,
          ["audioTracks", index, "sectionId"],
          "a section can have at most one audio track"
        );
      } else {
        seenAudioSections.add(track.sectionId);
      }
    }

    for (const [index, effect] of manifest.soundEffects.entries()) {
      if (!lineById.has(effect.lineId)) {
        addIssue(
          ctx,
          ["soundEffects", index, "lineId"],
          "sound effect lineId must reference a render line"
        );
      }
    }

    const introInserts = manifest.inserts.filter(
      (insert) => insert.role === "intro"
    );
    const outroInserts = manifest.inserts.filter(
      (insert) => insert.role === "outro"
    );
    if (introInserts.length > 1) {
      addIssue(ctx, ["inserts"], "at most one intro insert is allowed");
    }
    if (outroInserts.length > 1) {
      addIssue(ctx, ["inserts"], "at most one outro insert is allowed");
    }
    if (introInserts.length === 1) {
      const introIndex = manifest.inserts.findIndex(
        (insert) => insert.role === "intro"
      );
      if (introInserts[0].from !== 0) {
        addIssue(
          ctx,
          ["inserts", introIndex, "from"],
          "intro insert must start at frame 0"
        );
      }
    }
    if (outroInserts.length === 1) {
      const outroIndex = manifest.inserts.findIndex(
        (insert) => insert.role === "outro"
      );
      const outro = outroInserts[0];
      if (
        outro.from + outro.durationInFrames !==
        manifest.durationInFrames
      ) {
        addIssue(
          ctx,
          ["inserts", outroIndex, "from"],
          "outro insert must end at the manifest duration"
        );
      }
    }
  }
);
export const renderManifestV23Schema = renderManifestSchema;

export type SourceAssetChecksum = z.infer<typeof sourceAssetChecksumSchema>;
export type RenderLine = z.infer<typeof renderLineSchema>;
export type RenderCharacter = z.infer<typeof renderCharacterSchema>;
export type RenderCharacterVariant = z.infer<
  typeof renderCharacterVariantSchema
>;
export type LegacyRenderVideoDisplayV22 = z.infer<
  typeof legacyRenderVideoDisplayV22Schema
>;
export type RenderVideoDisplayV23 = z.infer<
  typeof renderVideoDisplayV23Schema
>;
export type RenderVisual = z.infer<typeof renderVisualSchema>;
export type RenderBackground = z.infer<typeof renderBackgroundSchema>;
export type RenderAudioTrack = z.infer<typeof renderAudioTrackSchema>;
export type RenderSoundEffect = z.infer<typeof renderSoundEffectSchema>;
export type RenderInsert = z.infer<typeof renderInsertSchema>;
export type RenderVideoInsert = z.infer<typeof renderVideoInsertSchema>;
export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type LegacyRenderManifestV22 = z.infer<
  typeof legacyRenderManifestV22Schema
>;
