import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject
} from "../../schema/index.js";

const cacheKeyPattern = /^[0-9a-f]{64}$/;

export const voicevoxAudioCacheKeySchema = z
  .string()
  .regex(cacheKeyPattern, "must be a lowercase SHA-256 cache key");

export const voicevoxAppliedTermSchema = strictObject({
  termId: idSchema,
  surface: z.string().min(1),
  reading: z.string().min(1),
  termUpdatedAt: isoUtcDateTimeSchema
});

export const voicevoxAudioIndexEntrySchema = strictObject({
  lineId: idSchema,
  audioPath: relativePosixPathSchema,
  cacheKey: voicevoxAudioCacheKeySchema,
  audioSha256: sha256Schema,
  durationMs: positiveIntegerSchema,
  generatedAt: isoUtcDateTimeSchema,
  voicevoxEngineVersion: z.string().min(1),
  speakerUuid: z.string().min(1),
  styleName: z.string().min(1),
  resolvedStyleId: finiteNumberSchema.int(),
  resolvedSpokenText: z.string().min(1),
  appliedTerms: z.array(voicevoxAppliedTermSchema),
  queryPath: relativePosixPathSchema
});

export const voicevoxAudioIndexSchema = z
  .record(idSchema, voicevoxAudioIndexEntrySchema)
  .superRefine((entries, ctx) => {
    for (const [lineId, entry] of Object.entries(entries)) {
      if (lineId !== entry.lineId) {
        ctx.addIssue({
          code: "custom",
          path: [lineId, "lineId"],
          message: "audio index key must match entry.lineId"
        });
      }
    }
  });

export type VoicevoxAppliedTerm = z.infer<typeof voicevoxAppliedTermSchema>;
export type VoicevoxAudioIndexEntry = z.infer<
  typeof voicevoxAudioIndexEntrySchema
>;
export type VoicevoxAudioIndex = z.infer<typeof voicevoxAudioIndexSchema>;
