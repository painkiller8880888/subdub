import { z } from "zod";

import {
  approvalStatusSchema,
  backgroundDefinitionSchema,
  displaySchema,
  displayV13Schema,
  displayV15Schema,
  expressionSchema,
  legacyDisplaySchema,
  sectionRoleSchema,
  voiceOverridesSchema,
  voiceSchema
} from "./common.js";
import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject,
  unitIntervalSchema
} from "./primitives.js";
import { editVideoPlaybackRateSchema } from "./edit-video.js";
import { validateVisualPlaybackSequence } from "../timeline/visual-playback.js";
import { lineOverlayPlanSchema } from "./line-overlay.js";

export const outputSettingsSchema = strictObject({
  width: z.literal(1920),
  height: z.literal(1080),
  fps: z.literal(30),
  videoCodec: z.literal("h264"),
  pixelFormat: z.literal("yuv420p"),
  audioCodec: z.literal("aac"),
  audioSampleRate: z.literal(48000),
  audioChannels: z.literal(2)
});

export const projectMetadataSchema = strictObject({
  id: idSchema,
  title: z.string(),
  description: z.string(),
  department: z.string(),
  manualVersion: z.string(),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema,
  outputSettings: outputSettingsSchema
});

export const projectSourceSchema = strictObject({
  id: idSchema,
  path: z.literal("source/source.md"),
  sha256: sha256Schema
});

export const projectBriefSchema = strictObject({
  audience: z.string(),
  postViewingGoal: z.string(),
  prerequisites: z.array(z.string()),
  targetDurationSec: positiveIntegerSchema,
  requiredItems: z.array(z.string()),
  prohibitedItems: z.array(z.string()),
  globalDirectives: z.array(z.string())
});

export const aiTaskKindSchema = z.enum([
  "outline_generation",
  "script_generation",
  "script_review",
  "visual_search_intent",
  "layout_review",
  "opencode"
]);

export const taskModelOverridesSchema = strictObject({
  outline_generation: z.string().optional(),
  script_generation: z.string().optional(),
  script_review: z.string().optional(),
  visual_search_intent: z.string().optional(),
  layout_review: z.string().optional(),
  opencode: z.string().optional()
});

export const aiSettingsSchema = strictObject({
  defaultModelId: z.string().nullable(),
  taskModelOverrides: taskModelOverridesSchema,
  zdr: z.boolean(),
  dataCollection: z.literal("deny"),
  allowProviderFallbacks: z.literal(true)
});

export const mouthPairSchema = strictObject({
  closed: relativePosixPathSchema,
  open: relativePosixPathSchema
});

export const characterVisualBindingSchema = strictObject({
  visualId: idSchema.nullable(),
  idleVariantId: idSchema.nullable()
});

export const characterSchema = strictObject({
  id: idSchema,
  name: z.string(),
  role: z.enum(["mentor", "learner"]),
  personality: z.string(),
  speakingStyle: z.string(),
  voicevox: strictObject({
    speakerName: z.enum(["四国めたん", "ずんだもん"]),
    speakerUuid: z.string().nullable(),
    styleName: z.literal("ノーマル")
  }),
  themeColorToken: z.enum(["character.metan", "character.zundamon"]),
  voice: voiceSchema,
  lipSyncPeriodFrames: positiveIntegerSchema,
  characterVisual: characterVisualBindingSchema,
  visualAssets: strictObject({
    neutral: mouthPairSchema,
    smile: mouthPairSchema,
    explain: mouthPairSchema,
    caution: mouthPairSchema
  })
});

export const sourceRefSchema = strictObject({
  sourceId: idSchema,
  headingPath: z.array(z.string())
});

export const openQuestionSchema = strictObject({
  id: idSchema,
  question: z.string(),
  resolution: z.string().nullable(),
  status: z.enum(["open", "resolved"])
});

export const outlineSectionSchema = strictObject({
  id: idSchema,
  order: finiteNumberSchema.int().nonnegative(),
  role: sectionRoleSchema,
  title: z.string(),
  overview: z.string(),
  keyPoints: z.array(z.string()),
  targetDurationSec: positiveIntegerSchema,
  sourceRefs: z.array(sourceRefSchema),
  openQuestions: z.array(openQuestionSchema),
  humanDirectives: strictObject({
    requiredItems: z.array(z.string()),
    prohibitedItems: z.array(z.string()),
    scriptConstraints: z.array(z.string())
  }),
  lockedFields: z.array(z.string())
});

export const outlineSchema = strictObject({
  status: approvalStatusSchema,
  sourceHash: sha256Schema,
  generationRunId: idSchema.nullable(),
  openQuestions: z.array(openQuestionSchema),
  sections: z.array(outlineSectionSchema)
});

export const pronunciationSchema = strictObject({
  mode: z.enum(["dictionary", "literal"]),
  excludedTermIds: z.array(idSchema)
});

const scriptLineV12Schema = strictObject({
  id: idSchema,
  speakerId: idSchema,
  spokenText: z.string().refine((value) => value.trim().length > 0, {
    message: "spokenText must not be blank"
  }),
  subtitleText: z.string().refine((value) => value.trim().length > 0, {
    message: "subtitleText must not be blank"
  }),
  expression: expressionSchema,
  characterVariantId: idSchema.nullable(),
  pauseBeforeMs: finiteNumberSchema.int().nonnegative(),
  pauseAfterMs: finiteNumberSchema.int().nonnegative(),
  voiceOverrides: voiceOverridesSchema,
  pronunciation: pronunciationSchema
});

export const scriptLineV13Schema = strictObject({
  ...scriptLineV12Schema.shape,
  screenTemplateId: idSchema.nullable()
});

const scriptSectionV12Schema = strictObject({
  id: idSchema,
  outlineSectionId: idSchema,
  name: z.string(),
  background: backgroundDefinitionSchema,
  lines: z.array(scriptLineV12Schema)
});

export const scriptSectionV13Schema = strictObject({
  ...scriptSectionV12Schema.shape,
  screenTemplateId: idSchema,
  lines: z.array(scriptLineV13Schema)
});

const scriptSchemaV12 = strictObject({
  status: approvalStatusSchema,
  origin: z.enum(["manual", "ai", "imported"]),
  outlineHash: sha256Schema,
  sections: z.array(scriptSectionV12Schema)
});

export const scriptSchemaV13 = strictObject({
  ...scriptSchemaV12.shape,
  sections: z.array(scriptSectionV13Schema)
});

export const scriptLineSchema = scriptLineV12Schema;

export const scriptSectionSchema = strictObject({
  ...scriptSectionV12Schema.shape,
  screenTemplateId: idSchema,
  lines: z.array(scriptLineSchema)
});

export const scriptSchema = strictObject({
  ...scriptSchemaV12.shape,
  sections: z.array(scriptSectionSchema)
});

const visualAssignmentV12Schema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  display: displaySchema
});

export const visualAssignmentV13Schema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  display: displayV13Schema
});

export const visualAssignmentV14Schema = visualAssignmentV13Schema;

export const visualAssignmentV15Schema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  display: displayV15Schema
});

export const visualAssignmentSchema = visualAssignmentV15Schema;

const legacyVisualAssignmentSchema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  display: legacyDisplaySchema
});

const visualPlanV12Schema = strictObject({
  status: approvalStatusSchema,
  suggestionRunIds: z.array(idSchema),
  assignments: z.array(visualAssignmentV12Schema)
});

export const visualPlanV13Schema = strictObject({
  ...visualPlanV12Schema.shape,
  assignments: z.array(visualAssignmentV13Schema)
});

export const visualPlanV14Schema = strictObject({
  ...visualPlanV12Schema.shape,
  assignments: z.array(visualAssignmentV14Schema)
});

export const visualPlanV15Schema = strictObject({
  ...visualPlanV12Schema.shape,
  assignments: z.array(visualAssignmentV15Schema)
});

export const visualPlanSchema = visualPlanV15Schema;

const legacyVisualPlanSchema = strictObject({
  status: approvalStatusSchema,
  suggestionRunIds: z.array(idSchema),
  assignments: z.array(legacyVisualAssignmentSchema)
});

const projectAssetSnapshotFields = {
  assetId: idSchema,
  assetVersion: positiveIntegerSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema
};

export const projectAssetSnapshotSchema = strictObject(
  projectAssetSnapshotFields
);

export const editVideoPlacementSchema = z.discriminatedUnion("kind", [
  strictObject({ kind: z.literal("before_first_section") }),
  strictObject({
    kind: z.literal("before_section"),
    sectionId: idSchema,
    order: nonNegativeIntegerSchema
  }),
  strictObject({ kind: z.literal("after_last_section") })
]);

export const editVideoElementV15Schema = strictObject({
  ...projectAssetSnapshotFields,
  id: idSchema,
  role: z.enum(["intro", "outro", "cutin"]),
  placement: editVideoPlacementSchema,
  volume: unitIntervalSchema
});

export const sectionBgmAssignmentSchema = strictObject({
  ...projectAssetSnapshotFields,
  id: idSchema,
  sectionId: idSchema,
  volume: unitIntervalSchema
});

export const editPlanV15Schema = strictObject({
  videoElements: z.array(editVideoElementV15Schema),
  sectionBgms: z.array(sectionBgmAssignmentSchema)
});

export const editVideoElementV16Schema = strictObject({
  ...projectAssetSnapshotFields,
  id: idSchema,
  role: z.enum(["intro", "outro", "cutin"]),
  placement: editVideoPlacementSchema,
  volume: unitIntervalSchema,
  text: z.string(),
  textTemplateId: idSchema.nullable()
});

export const editPlanV16Schema = strictObject({
  videoElements: z.array(editVideoElementV16Schema),
  sectionBgms: z.array(sectionBgmAssignmentSchema)
});

export const editVideoElementSchema = strictObject({
  ...editVideoElementV16Schema.shape,
  startMs: nonNegativeIntegerSchema.nullable(),
  playbackRate: editVideoPlaybackRateSchema
});

export const editPlanSchema = strictObject({
  videoElements: z.array(editVideoElementSchema),
  sectionBgms: z.array(sectionBgmAssignmentSchema)
});

/** `1.1.0` compatibility input only. */
export const legacySectionBgmSchema = strictObject({
  id: idSchema,
  sectionId: idSchema,
  path: relativePosixPathSchema,
  volume: unitIntervalSchema,
  loop: z.boolean(),
  fadeInMs: finiteNumberSchema.int().nonnegative(),
  fadeOutMs: finiteNumberSchema.int().nonnegative()
});

/** @deprecated Use legacySectionBgmSchema for 1.1.0 compatibility input. */
export const sectionBgmSchema = legacySectionBgmSchema;

export const soundEffectSchema = strictObject({
  id: idSchema,
  soundEffectAssetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  category: z.enum(["confirm", "attention", "warning"]),
  lineId: idSchema,
  offsetMs: finiteNumberSchema.int().nonnegative(),
  volume: unitIntervalSchema
});

export const DEFAULT_SOUND_EFFECT_VOLUME = 0.2 as const;

export const audioPlanSchema = strictObject({
  soundEffects: z.array(soundEffectSchema)
});

export const legacyAudioPlanSchema = strictObject({
  sectionBgms: z.array(legacySectionBgmSchema),
  soundEffects: z.array(soundEffectSchema)
});

const placeholderInsertFields = {
  id: idSchema,
  kind: z.literal("placeholder"),
  durationMs: z.literal(2000)
};

export const openingPlaceholderSchema = strictObject({
  ...placeholderInsertFields,
  slot: z.literal("opening")
});

export const endingPlaceholderSchema = strictObject({
  ...placeholderInsertFields,
  slot: z.literal("ending")
});

export const placeholderInsertSchema = z.discriminatedUnion("slot", [
  openingPlaceholderSchema,
  endingPlaceholderSchema
]);

export const eyeCatchPlaceholderSchema = strictObject({
  id: idSchema,
  kind: z.literal("placeholder"),
  slot: z.literal("eye_catch"),
  beforeSectionId: idSchema,
  durationMs: z.literal(2000)
});

export const insertPlanSchema = strictObject({
  opening: openingPlaceholderSchema,
  ending: endingPlaceholderSchema,
  eyeCatches: z.array(eyeCatchPlaceholderSchema)
});

export const thumbnailPlanSchema = strictObject({
  backgroundImage: relativePosixPathSchema.nullable(),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  departmentOrSystem: z.string().min(1),
  manualVersion: z.string().nullable(),
  characterId: idSchema.nullable(),
  representativeVisualPath: relativePosixPathSchema.nullable(),
  layout: z.literal("standard")
});

const videoProjectV12BaseSchema = strictObject({
  schemaVersion: z.literal("1.2.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchemaV12,
  visuals: visualPlanV12Schema,
  audio: audioPlanSchema,
  edit: editPlanV15Schema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV13BaseSchema = strictObject({
  schemaVersion: z.literal("1.3.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchemaV13,
  visuals: visualPlanV13Schema,
  audio: audioPlanSchema,
  edit: editPlanV15Schema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV14BaseSchema = strictObject({
  schemaVersion: z.literal("1.4.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchema,
  visuals: visualPlanV14Schema,
  audio: audioPlanSchema,
  edit: editPlanV15Schema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV15BaseSchema = strictObject({
  schemaVersion: z.literal("1.5.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchema,
  visuals: visualPlanV15Schema,
  audio: audioPlanSchema,
  edit: editPlanV15Schema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV16BaseSchema = strictObject({
  schemaVersion: z.literal("1.6.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchema,
  visuals: visualPlanV15Schema,
  audio: audioPlanSchema,
  edit: editPlanV16Schema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV17BaseSchema = strictObject({
  schemaVersion: z.literal("1.7.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchema,
  visuals: visualPlanV15Schema,
  audio: audioPlanSchema,
  edit: editPlanSchema,
  thumbnail: thumbnailPlanSchema
});

const videoProjectV18BaseSchema = videoProjectV17BaseSchema.extend({
  schemaVersion: z.literal("1.8.0"),
  overlays: lineOverlayPlanSchema
});

const legacyVideoProjectV11BaseSchema = strictObject({
  schemaVersion: z.literal("1.1.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchemaV12,
  visuals: legacyVisualPlanSchema,
  audio: legacyAudioPlanSchema,
  inserts: insertPlanSchema,
  thumbnail: thumbnailPlanSchema
});

export const legacyVideoProjectV11Schema = legacyVideoProjectV11BaseSchema;

/**
 * The 1.0.0 input boundary is intentionally kept strict so that a project
 * carrying 1.1.0-only fields cannot be relabeled and accepted as a migrated
 * project before the legacy shape has been validated.
 */
const legacyCharacterSchema = characterSchema.omit({
  characterVisual: true
});
const legacyScriptLineSchema = scriptLineV12Schema.omit({
  characterVariantId: true
});
const legacyScriptSectionSchema = scriptSectionV12Schema.extend({
  lines: z.array(legacyScriptLineSchema)
});
const legacyScriptSchema = scriptSchemaV12.extend({
  sections: z.array(legacyScriptSectionSchema)
});

export const legacyVideoProjectSchema = legacyVideoProjectV11BaseSchema.extend({
  schemaVersion: z.literal("1.0.0"),
  characters: z.array(legacyCharacterSchema).length(2),
  script: legacyScriptSchema
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

function addReferenceIssue(
  ctx: z.RefinementCtx,
  path: IssuePath,
  message: string
): void {
  ctx.addIssue({ code: "custom", path, message });
}

type VideoProjectDomainShape =
  | z.infer<typeof videoProjectV12BaseSchema>
  | z.infer<typeof videoProjectV13BaseSchema>
  | z.infer<typeof videoProjectV14BaseSchema>
  | z.infer<typeof videoProjectV15BaseSchema>
  | z.infer<typeof videoProjectV16BaseSchema>
  | z.infer<typeof videoProjectV17BaseSchema>
  | z.infer<typeof videoProjectV18BaseSchema>;

function refineVideoProject(
  project: VideoProjectDomainShape,
  ctx: z.RefinementCtx
): void {
    const characterEntries = project.characters.map((character, index) => ({
      value: character.id,
      path: ["characters", index, "id"]
    }));
    addDuplicateIssues(characterEntries, ctx, "character id");

    const expectedCharacters: ReadonlyMap<
      string,
      {
        role: "mentor" | "learner";
        speakerName: "四国めたん" | "ずんだもん";
        themeColorToken: "character.metan" | "character.zundamon";
      }
    > = new Map([
      [
        "character-mentor",
        {
          role: "mentor",
          speakerName: "四国めたん",
          themeColorToken: "character.metan"
        }
      ],
      [
        "character-learner",
        {
          role: "learner",
          speakerName: "ずんだもん",
          themeColorToken: "character.zundamon"
        }
      ]
    ] as const);

    for (const [index, character] of project.characters.entries()) {
      const expected = expectedCharacters.get(character.id);
      if (expected === undefined) {
        addReferenceIssue(
          ctx,
          ["characters", index, "id"],
          "MVP character id is not supported"
        );
        continue;
      }

      if (character.role !== expected.role) {
        addReferenceIssue(
          ctx,
          ["characters", index, "role"],
          "character role does not match the character id"
        );
      }
      if (character.voicevox.speakerName !== expected.speakerName) {
        addReferenceIssue(
          ctx,
          ["characters", index, "voicevox", "speakerName"],
          "VOICEVOX speaker does not match the character id"
        );
      }
      if (character.themeColorToken !== expected.themeColorToken) {
        addReferenceIssue(
          ctx,
          ["characters", index, "themeColorToken"],
          "theme color token does not match the character id"
        );
      }

      if (
        character.characterVisual.visualId === null &&
        character.characterVisual.idleVariantId !== null
      ) {
        addReferenceIssue(
          ctx,
          ["characters", index, "characterVisual", "idleVariantId"],
          "idleVariantId requires a visualId"
        );
      }
    }

    for (const id of expectedCharacters.keys()) {
      if (!project.characters.some((character) => character.id === id)) {
        addReferenceIssue(ctx, ["characters"], `missing MVP character: ${id}`);
      }
    }

    const outlineSectionEntries = project.outline.sections.map(
      (section, index) => ({
        value: section.id,
        path: ["outline", "sections", index, "id"]
      })
    );
    addDuplicateIssues(outlineSectionEntries, ctx, "outline section id");

    const openQuestionEntries = [
      ...project.outline.openQuestions.map((question, index) => ({
        value: question.id,
        path: ["outline", "openQuestions", index, "id"]
      })),
      ...project.outline.sections.flatMap((section, sectionIndex) =>
        section.openQuestions.map((question, questionIndex) => ({
          value: question.id,
          path: [
            "outline",
            "sections",
            sectionIndex,
            "openQuestions",
            questionIndex,
            "id"
          ]
        }))
      )
    ];
    addDuplicateIssues(openQuestionEntries, ctx, "open question id");

    const outlineSectionIds = new Set(
      project.outline.sections.map((section) => section.id)
    );
    for (const [sectionIndex, section] of project.outline.sections.entries()) {
      for (const [sourceRefIndex, sourceRef] of section.sourceRefs.entries()) {
        if (sourceRef.sourceId !== project.source.id) {
          addReferenceIssue(
            ctx,
            [
              "outline",
              "sections",
              sectionIndex,
              "sourceRefs",
              sourceRefIndex,
              "sourceId"
            ],
            "source reference must reference source.id"
          );
        }
      }
    }

    const scriptSectionEntries = project.script.sections.map(
      (section, index) => ({
        value: section.id,
        path: ["script", "sections", index, "id"]
      })
    );
    addDuplicateIssues(scriptSectionEntries, ctx, "script section id");

    for (const [sectionIndex, section] of project.script.sections.entries()) {
      if (!outlineSectionIds.has(section.outlineSectionId)) {
        addReferenceIssue(
          ctx,
          ["script", "sections", sectionIndex, "outlineSectionId"],
          "script section must reference an outline section"
        );
      }
    }

    const lineEntries = project.script.sections.flatMap(
      (section, sectionIndex) =>
        section.lines.map((line, lineIndex) => ({
          line,
          section,
          sectionIndex,
          lineIndex,
          path: ["script", "sections", sectionIndex, "lines", lineIndex]
        }))
    );
    addDuplicateIssues(
      lineEntries.map((entry) => ({
        value: entry.line.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "script line id"
    );

    const characterIds = new Set(
      project.characters.map((character) => character.id)
    );
    const lineById = new Map<string, (typeof lineEntries)[number]>();
    for (const entry of lineEntries) {
      if (!lineById.has(entry.line.id)) {
        lineById.set(entry.line.id, entry);
      }
      if (!characterIds.has(entry.line.speakerId)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "speakerId"],
          "line speakerId must reference a character"
        );
      }
    }

    const visualAssignmentEntries = project.visuals.assignments.map(
      (assignment, index) => ({
        assignment,
        index,
        path: ["visuals", "assignments", index]
      })
    );
    addDuplicateIssues(
      visualAssignmentEntries.map((entry) => ({
        value: entry.assignment.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "visual assignment id"
    );

    for (const entry of visualAssignmentEntries) {
      const start = lineById.get(entry.assignment.startLineId);
      const end = lineById.get(entry.assignment.endLineId);

      if (start === undefined) {
        addReferenceIssue(
          ctx,
          [...entry.path, "startLineId"],
          "visual assignment startLineId must reference a line"
        );
      }
      if (end === undefined) {
        addReferenceIssue(
          ctx,
          [...entry.path, "endLineId"],
          "visual assignment endLineId must reference a line"
        );
      }
      if (start !== undefined && end !== undefined) {
        if (start.section.id !== end.section.id) {
          addReferenceIssue(
            ctx,
            [...entry.path, "endLineId"],
            "visual assignment range must stay within one script section"
          );
        } else if (start.lineIndex > end.lineIndex) {
          addReferenceIssue(
            ctx,
            [...entry.path, "startLineId"],
            "visual assignment startLineId must not follow endLineId"
          );
        }
      }

      if (
        entry.assignment.display.kind === "video" &&
        "playbackCues" in entry.assignment.display
      ) {
        const playbackValidation = validateVisualPlaybackSequence(
          {
            id: entry.assignment.id,
            startLineId: entry.assignment.startLineId,
            endLineId: entry.assignment.endLineId,
            display: entry.assignment.display
          },
          project.script
        );
        if (!playbackValidation.success) {
          for (const playbackIssue of playbackValidation.issues) {
            addReferenceIssue(
              ctx,
              [...entry.path, ...playbackIssue.path],
              playbackIssue.message
            );
          }
        }
      }
    }

    const annotationEntries = visualAssignmentEntries.flatMap((entry) =>
      entry.assignment.display.annotations.map((annotation, annotationIndex) => ({
        value: annotation.id,
        path: [
          ...entry.path,
          "display",
          "annotations",
          annotationIndex,
          "id"
        ]
      }))
    );
    addDuplicateIssues(annotationEntries, ctx, "annotation id");

    if ("overlays" in project) {
      const lineOverlayEntries = project.overlays.lineOverlays.map(
        (overlay, index) => ({
          overlay,
          path: ["overlays", "lineOverlays", index]
        })
      );
      addDuplicateIssues(
        lineOverlayEntries.map((entry) => ({
          value: entry.overlay.id,
          path: [...entry.path, "id"]
        })),
        ctx,
        "line overlay id"
      );
      for (const entry of lineOverlayEntries) {
        if (!lineById.has(entry.overlay.lineId)) {
          addReferenceIssue(
            ctx,
            [...entry.path, "lineId"],
            "line overlay lineId must reference a script line"
          );
        }
      }
    }

    const scriptSectionIds = new Set(
      project.script.sections.map((section) => section.id)
    );
    const firstScriptSectionId = project.script.sections[0]?.id;

    const videoElementEntries = project.edit.videoElements.map(
      (element, index) => ({
        element,
        path: ["edit", "videoElements", index]
      })
    );
    addDuplicateIssues(
      videoElementEntries.map((entry) => ({
        value: entry.element.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "edit video element id"
    );

    const introElements = videoElementEntries.filter(
      (entry) => entry.element.role === "intro"
    );
    const outroElements = videoElementEntries.filter(
      (entry) => entry.element.role === "outro"
    );
    if (introElements.length > 1) {
      addReferenceIssue(
        ctx,
        [...introElements[1]!.path, "role"],
        "edit plan can contain at most one intro"
      );
    }
    if (outroElements.length > 1) {
      addReferenceIssue(
        ctx,
        [...outroElements[1]!.path, "role"],
        "edit plan can contain at most one outro"
      );
    }

    const cutinOrdersBySection = new Map<string, Set<number>>();
    for (const entry of videoElementEntries) {
      const placement = entry.element.placement;
      if (entry.element.role === "intro") {
        if (placement.kind !== "before_first_section") {
          addReferenceIssue(
            ctx,
            [...entry.path, "placement"],
            "intro must be placed before the first section"
          );
        }
        continue;
      }
      if (entry.element.role === "outro") {
        if (placement.kind !== "after_last_section") {
          addReferenceIssue(
            ctx,
            [...entry.path, "placement"],
            "outro must be placed after the last section"
          );
        }
        continue;
      }

      if (placement.kind !== "before_section") {
        addReferenceIssue(
          ctx,
          [...entry.path, "placement"],
          "cutin must be placed before a section"
        );
        continue;
      }
      if (!scriptSectionIds.has(placement.sectionId)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "placement", "sectionId"],
          "cutin sectionId must reference a script section"
        );
      } else if (placement.sectionId === firstScriptSectionId) {
        addReferenceIssue(
          ctx,
          [...entry.path, "placement", "sectionId"],
          "cutin cannot be placed before the first script section"
        );
      }
      const orders = cutinOrdersBySection.get(placement.sectionId) ?? new Set();
      if (orders.has(placement.order)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "placement", "order"],
          "cutin order must be unique within a section boundary"
        );
      }
      orders.add(placement.order);
      cutinOrdersBySection.set(placement.sectionId, orders);
    }

    const sectionBgmEntries = project.edit.sectionBgms.map((bgm, index) => ({
      bgm,
      path: ["edit", "sectionBgms", index]
    }));
    addDuplicateIssues(
      sectionBgmEntries.map((entry) => ({
        value: entry.bgm.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "section BGM id"
    );
    const seenBgmSections = new Set<string>();
    for (const entry of sectionBgmEntries) {
      if (!scriptSectionIds.has(entry.bgm.sectionId)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "sectionId"],
          "section BGM sectionId must reference a script section"
        );
      }
      if (seenBgmSections.has(entry.bgm.sectionId)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "sectionId"],
          "a section can have at most one BGM"
        );
      } else {
        seenBgmSections.add(entry.bgm.sectionId);
      }
    }

    const soundEffectEntries = project.audio.soundEffects.map((effect, index) => ({
      effect,
      path: ["audio", "soundEffects", index]
    }));
    addDuplicateIssues(
      soundEffectEntries.map((entry) => ({
        value: entry.effect.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "sound effect id"
    );
    for (const entry of soundEffectEntries) {
      if (!lineById.has(entry.effect.lineId)) {
        addReferenceIssue(
          ctx,
          [...entry.path, "lineId"],
          "sound effect lineId must reference a script line"
        );
      }
    }

    if (
      project.thumbnail.characterId !== null &&
      !characterIds.has(project.thumbnail.characterId)
    ) {
      addReferenceIssue(
        ctx,
        ["thumbnail", "characterId"],
        "thumbnail characterId must reference a character"
      );
    }
}

export const videoProjectV12Schema =
  videoProjectV12BaseSchema.superRefine(refineVideoProject);
export const videoProjectV13Schema =
  videoProjectV13BaseSchema.superRefine(refineVideoProject);
export const videoProjectV14Schema =
  videoProjectV14BaseSchema.superRefine(refineVideoProject);
export const videoProjectV15Schema =
  videoProjectV15BaseSchema.superRefine(refineVideoProject);
export const videoProjectV16Schema =
  videoProjectV16BaseSchema.superRefine(refineVideoProject);
export const videoProjectV17Schema =
  videoProjectV17BaseSchema.superRefine(refineVideoProject);
export const videoProjectV18Schema =
  videoProjectV18BaseSchema.superRefine(refineVideoProject);
export const videoProjectSchema = videoProjectV18Schema;

export type AiTaskKind = z.infer<typeof aiTaskKindSchema>;
export type OutputSettings = z.infer<typeof outputSettingsSchema>;
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
export type ProjectSource = z.infer<typeof projectSourceSchema>;
export type ProjectBrief = z.infer<typeof projectBriefSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type Character = z.infer<typeof characterSchema>;
export type CharacterVisualBinding = z.infer<
  typeof characterVisualBindingSchema
>;
export type MouthPair = z.infer<typeof mouthPairSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type OutlineSection = z.infer<typeof outlineSectionSchema>;
export type Outline = z.infer<typeof outlineSchema>;
export type Pronunciation = z.infer<typeof pronunciationSchema>;
export type ScriptLine = z.infer<typeof scriptLineSchema>;
export type ScriptSection = z.infer<typeof scriptSectionSchema>;
export type Script = z.infer<typeof scriptSchema>;
export type ScriptLineV12 = z.infer<typeof scriptLineV12Schema>;
export type ScriptSectionV12 = z.infer<typeof scriptSectionV12Schema>;
export type ScriptV12 = z.infer<typeof scriptSchemaV12>;
export type ScriptLineV13 = z.infer<typeof scriptLineV13Schema>;
export type ScriptSectionV13 = z.infer<typeof scriptSectionV13Schema>;
export type ScriptV13 = z.infer<typeof scriptSchemaV13>;
export type VisualAssignmentV12 = z.infer<typeof visualAssignmentV12Schema>;
export type VisualAssignmentV13 = z.infer<typeof visualAssignmentV13Schema>;
export type VisualAssignmentV14 = z.infer<typeof visualAssignmentV14Schema>;
export type VisualAssignment = z.infer<typeof visualAssignmentSchema>;
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export type VisualPlanV12 = z.infer<typeof visualPlanV12Schema>;
export type VisualPlanV13 = z.infer<typeof visualPlanV13Schema>;
export type VisualPlanV14 = z.infer<typeof visualPlanV14Schema>;
export type VisualPlanV15 = z.infer<typeof visualPlanV15Schema>;
export type ProjectAssetSnapshot = z.infer<typeof projectAssetSnapshotSchema>;
export type EditVideoPlacement = z.infer<typeof editVideoPlacementSchema>;
export type EditVideoElementV15 = z.infer<typeof editVideoElementV15Schema>;
export type EditVideoElementV16 = z.infer<typeof editVideoElementV16Schema>;
export type EditVideoElement = z.infer<typeof editVideoElementSchema>;
export type SectionBgmAssignment = z.infer<
  typeof sectionBgmAssignmentSchema
>;
export type EditPlan = z.infer<typeof editPlanSchema>;
export type EditPlanV16 = z.infer<typeof editPlanV16Schema>;
export type EditPlanV15 = z.infer<typeof editPlanV15Schema>;
export type LegacySectionBgm = z.infer<typeof legacySectionBgmSchema>;
/** @deprecated Use SectionBgmAssignment for current projects. */
export type SectionBgm = LegacySectionBgm;
export type SoundEffect = z.infer<typeof soundEffectSchema>;
export type SoundEffectDraft = Omit<SoundEffect, "volume"> & {
  volume?: number;
};

/**
 * Creates a new sound effect definition at the creation boundary.
 * Persisted project parsing does not call this factory and never rewrites
 * an existing volume.
 */
export function createSoundEffect(input: SoundEffectDraft): SoundEffect {
  return soundEffectSchema.parse({
    ...input,
    volume: input.volume ?? DEFAULT_SOUND_EFFECT_VOLUME
  });
}

export type AudioPlan = z.infer<typeof audioPlanSchema>;
export type PlaceholderInsert = z.infer<typeof placeholderInsertSchema>;
export type OpeningPlaceholder = z.infer<typeof openingPlaceholderSchema>;
export type EndingPlaceholder = z.infer<typeof endingPlaceholderSchema>;
export type EyeCatchPlaceholder = z.infer<typeof eyeCatchPlaceholderSchema>;
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type ThumbnailPlan = z.infer<typeof thumbnailPlanSchema>;
export type VideoProjectV12 = z.infer<typeof videoProjectV12Schema>;
export type VideoProjectV13 = z.infer<typeof videoProjectV13Schema>;
export type VideoProjectV14 = z.infer<typeof videoProjectV14Schema>;
export type VideoProjectV15 = z.infer<typeof videoProjectV15Schema>;
export type VideoProjectV16 = z.infer<typeof videoProjectV16Schema>;
export type VideoProjectV17 = z.infer<typeof videoProjectV17Schema>;
export type VideoProjectV18 = z.infer<typeof videoProjectV18Schema>;
export type VideoProject = z.infer<typeof videoProjectSchema>;
