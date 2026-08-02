import { z } from "zod";

import {
  backgroundDefinitionSchema,
  displaySchema,
  expressionSchema,
  visualAssetKindSchema
} from "./common.js";
import {
  idSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
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
  expression: expressionSchema
});

export const renderVisualSchema = strictObject({
  id: idSchema,
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  kind: visualAssetKindSchema,
  src: relativePosixPathSchema,
  display: displaySchema
});

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

export const renderInsertSchema = strictObject({
  id: idSchema,
  kind: z.literal("placeholder"),
  slot: z.enum(["opening", "ending", "eye_catch"]),
  beforeSectionId: idSchema.nullable(),
  from: nonNegativeIntegerSchema,
  durationInFrames: positiveIntegerSchema,
  label: z.string()
});

const renderManifestBaseSchema = strictObject({
  manifestVersion: z.literal("1.0.0"),
  sourceProjectHash: sha256Schema,
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

    const lineById = new Map<string, (typeof manifest.lines)[number]>();
    const sectionIds = new Set<string>();
    for (const [index, line] of manifest.lines.entries()) {
      if (!lineById.has(line.id)) {
        lineById.set(line.id, line);
      }
      sectionIds.add(line.sectionId);

      if (line.speechFrom < line.from) {
        addIssue(
          ctx,
          ["lines", index, "speechFrom"],
          "speech interval must start within the line interval"
        );
      }
      if (
        line.speechFrom + line.speechDurationInFrames >
        line.from + line.durationInFrames
      ) {
        addIssue(
          ctx,
          ["lines", index, "speechDurationInFrames"],
          "speech interval must fit within the line interval"
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

    const openingInserts = manifest.inserts.filter(
      (insert) => insert.slot === "opening"
    );
    const endingInserts = manifest.inserts.filter(
      (insert) => insert.slot === "ending"
    );
    if (openingInserts.length !== 1) {
      addIssue(ctx, ["inserts"], "exactly one opening insert is required");
    }
    if (endingInserts.length !== 1) {
      addIssue(ctx, ["inserts"], "exactly one ending insert is required");
    }

    const firstSectionId = manifest.lines[0]?.sectionId;
    for (const [index, insert] of manifest.inserts.entries()) {
      if (
        (insert.slot === "opening" || insert.slot === "ending") &&
        insert.beforeSectionId !== null
      ) {
        addIssue(
          ctx,
          ["inserts", index, "beforeSectionId"],
          "opening and ending inserts must have a null beforeSectionId"
        );
      }

      if (insert.slot === "eye_catch") {
        if (insert.beforeSectionId === null) {
          addIssue(
            ctx,
            ["inserts", index, "beforeSectionId"],
            "eye catch beforeSectionId must identify a section"
          );
        } else if (!sectionIds.has(insert.beforeSectionId)) {
          addIssue(
            ctx,
            ["inserts", index, "beforeSectionId"],
            "eye catch beforeSectionId must reference a section present in lines"
          );
        } else if (insert.beforeSectionId === firstSectionId) {
          addIssue(
            ctx,
            ["inserts", index, "beforeSectionId"],
            "eye catch cannot be placed before the first section"
          );
        }
      }
    }
  }
);

export type SourceAssetChecksum = z.infer<typeof sourceAssetChecksumSchema>;
export type RenderLine = z.infer<typeof renderLineSchema>;
export type RenderVisual = z.infer<typeof renderVisualSchema>;
export type RenderBackground = z.infer<typeof renderBackgroundSchema>;
export type RenderAudioTrack = z.infer<typeof renderAudioTrackSchema>;
export type RenderSoundEffect = z.infer<typeof renderSoundEffectSchema>;
export type RenderInsert = z.infer<typeof renderInsertSchema>;
export type RenderManifest = z.infer<typeof renderManifestSchema>;
