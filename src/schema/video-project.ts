import { z } from "zod";

import {
  approvalStatusSchema,
  backgroundDefinitionSchema,
  displaySchema,
  expressionSchema,
  sectionRoleSchema,
  voiceOverridesSchema,
  voiceSchema
} from "./common.js";
import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject,
  unitIntervalSchema
} from "./primitives.js";

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

export const scriptLineSchema = strictObject({
  id: idSchema,
  speakerId: idSchema,
  spokenText: z.string(),
  subtitleText: z.string(),
  expression: expressionSchema,
  pauseBeforeMs: finiteNumberSchema.int().nonnegative(),
  pauseAfterMs: finiteNumberSchema.int().nonnegative(),
  voiceOverrides: voiceOverridesSchema,
  pronunciation: pronunciationSchema
});

export const scriptSectionSchema = strictObject({
  id: idSchema,
  outlineSectionId: idSchema,
  name: z.string(),
  background: backgroundDefinitionSchema,
  lines: z.array(scriptLineSchema)
});

export const scriptSchema = strictObject({
  status: approvalStatusSchema,
  origin: z.enum(["manual", "ai", "imported"]),
  outlineHash: sha256Schema,
  sections: z.array(scriptSectionSchema)
});

export const visualAssignmentSchema = strictObject({
  id: idSchema,
  startLineId: idSchema,
  endLineId: idSchema,
  assetId: idSchema,
  assetChecksum: sha256Schema,
  projectMediaPath: relativePosixPathSchema,
  display: displaySchema
});

export const visualPlanSchema = strictObject({
  status: approvalStatusSchema,
  suggestionRunIds: z.array(idSchema),
  assignments: z.array(visualAssignmentSchema)
});

export const sectionBgmSchema = strictObject({
  id: idSchema,
  sectionId: idSchema,
  path: relativePosixPathSchema,
  volume: unitIntervalSchema,
  loop: z.boolean(),
  fadeInMs: finiteNumberSchema.int().nonnegative(),
  fadeOutMs: finiteNumberSchema.int().nonnegative()
});

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

export const audioPlanSchema = strictObject({
  sectionBgms: z.array(sectionBgmSchema),
  soundEffects: z.array(soundEffectSchema)
});

export const placeholderInsertSchema = strictObject({
  id: idSchema,
  kind: z.literal("placeholder"),
  slot: z.enum(["opening", "ending"]),
  durationMs: z.literal(2000)
});

export const eyeCatchPlaceholderSchema = strictObject({
  id: idSchema,
  kind: z.literal("placeholder"),
  slot: z.literal("eye_catch"),
  beforeSectionId: idSchema,
  durationMs: z.literal(2000)
});

export const insertPlanSchema = strictObject({
  opening: placeholderInsertSchema,
  ending: placeholderInsertSchema,
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

const videoProjectBaseSchema = strictObject({
  schemaVersion: z.literal("1.0.0"),
  revision: finiteNumberSchema.int().nonnegative(),
  metadata: projectMetadataSchema,
  source: projectSourceSchema,
  brief: projectBriefSchema,
  aiSettings: aiSettingsSchema,
  characters: z.array(characterSchema).length(2),
  outline: outlineSchema,
  script: scriptSchema,
  visuals: visualPlanSchema,
  audio: audioPlanSchema,
  inserts: insertPlanSchema,
  thumbnail: thumbnailPlanSchema
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

export const videoProjectSchema = videoProjectBaseSchema.superRefine(
  (project, ctx) => {
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

    const sectionBgmEntries = project.audio.sectionBgms.map((bgm, index) => ({
      bgm,
      path: ["audio", "sectionBgms", index]
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
    const scriptSectionIds = new Set(
      project.script.sections.map((section) => section.id)
    );
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

    const insertEntries = [
      { insert: project.inserts.opening, path: ["inserts", "opening"] },
      { insert: project.inserts.ending, path: ["inserts", "ending"] },
      ...project.inserts.eyeCatches.map((insert, index) => ({
        insert,
        path: ["inserts", "eyeCatches", index]
      }))
    ];
    addDuplicateIssues(
      insertEntries.map((entry) => ({
        value: entry.insert.id,
        path: [...entry.path, "id"]
      })),
      ctx,
      "insert id"
    );
    const firstScriptSectionId = project.script.sections[0]?.id;
    for (const [index, eyeCatch] of project.inserts.eyeCatches.entries()) {
      if (!scriptSectionIds.has(eyeCatch.beforeSectionId)) {
        addReferenceIssue(
          ctx,
          ["inserts", "eyeCatches", index, "beforeSectionId"],
          "eye catch must reference a script section"
        );
      } else if (eyeCatch.beforeSectionId === firstScriptSectionId) {
        addReferenceIssue(
          ctx,
          ["inserts", "eyeCatches", index, "beforeSectionId"],
          "eye catch cannot be placed before the first script section"
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
);

export type AiTaskKind = z.infer<typeof aiTaskKindSchema>;
export type OutputSettings = z.infer<typeof outputSettingsSchema>;
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
export type ProjectSource = z.infer<typeof projectSourceSchema>;
export type ProjectBrief = z.infer<typeof projectBriefSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type Character = z.infer<typeof characterSchema>;
export type MouthPair = z.infer<typeof mouthPairSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type OutlineSection = z.infer<typeof outlineSectionSchema>;
export type Outline = z.infer<typeof outlineSchema>;
export type Pronunciation = z.infer<typeof pronunciationSchema>;
export type ScriptLine = z.infer<typeof scriptLineSchema>;
export type ScriptSection = z.infer<typeof scriptSectionSchema>;
export type Script = z.infer<typeof scriptSchema>;
export type VisualAssignment = z.infer<typeof visualAssignmentSchema>;
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export type SectionBgm = z.infer<typeof sectionBgmSchema>;
export type SoundEffect = z.infer<typeof soundEffectSchema>;
export type AudioPlan = z.infer<typeof audioPlanSchema>;
export type PlaceholderInsert = z.infer<typeof placeholderInsertSchema>;
export type EyeCatchPlaceholder = z.infer<typeof eyeCatchPlaceholderSchema>;
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type ThumbnailPlan = z.infer<typeof thumbnailPlanSchema>;
export type VideoProject = z.infer<typeof videoProjectSchema>;
