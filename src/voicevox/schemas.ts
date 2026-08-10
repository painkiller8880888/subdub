import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  sha256Schema,
  strictObject
} from "../schema/primitives.js";

export const voicevoxStyleSchema = z.object({
  name: z.string().min(1),
  id: finiteNumberSchema.int()
});

export const voicevoxSpeakerSchema = z.object({
  name: z.string().min(1),
  speaker_uuid: z.string().min(1),
  styles: z.array(voicevoxStyleSchema)
});

export const voicevoxSpeakersResponseSchema = z.array(voicevoxSpeakerSchema);

export const voicevoxMoraSchema = z
  .object({
    text: z.string(),
    consonant: z.string().nullable(),
    consonant_length: finiteNumberSchema.nullable(),
    vowel: z.string(),
    vowel_length: finiteNumberSchema,
    pitch: finiteNumberSchema,
    is_devoiced: z.boolean().optional()
  })
  .passthrough();

export const voicevoxAccentPhraseSchema = z
  .object({
    moras: z.array(voicevoxMoraSchema),
    accent: finiteNumberSchema.int(),
    pause_mora: voicevoxMoraSchema.nullable(),
    is_interrogative: z.boolean()
  })
  .passthrough();

export const voicevoxEngineVersionSchema = z.string().min(1);

export const voicevoxAudioQuerySchema = z
  .object({
    accent_phrases: z.array(voicevoxAccentPhraseSchema),
    speedScale: finiteNumberSchema,
    pitchScale: finiteNumberSchema,
    intonationScale: finiteNumberSchema,
    volumeScale: finiteNumberSchema,
    prePhonemeLength: finiteNumberSchema,
    postPhonemeLength: finiteNumberSchema,
    outputSamplingRate: finiteNumberSchema.int().positive(),
    outputStereo: z.boolean(),
    kana: z.string()
  })
  .passthrough();

export const voicevoxAdjustmentScalarOverridesSchema = strictObject({
  speedScale: finiteNumberSchema.optional(),
  pitchScale: finiteNumberSchema.optional(),
  intonationScale: finiteNumberSchema.optional(),
  volumeScale: finiteNumberSchema.optional(),
  prePhonemeLength: finiteNumberSchema.optional(),
  postPhonemeLength: finiteNumberSchema.optional()
});

export const voicevoxAdjustmentBaseSchema = strictObject({
  baseHash: sha256Schema,
  resolvedSpokenText: z.string().min(1),
  speakerUuid: z.string().min(1),
  styleName: z.string().min(1),
  resolvedStyleId: finiteNumberSchema.int(),
  voicevoxEngineVersion: voicevoxEngineVersionSchema
});

export const voicevoxAdjustmentFileSchema = strictObject({
  adjustmentVersion: z.literal("1.0.0"),
  lineId: idSchema,
  base: voicevoxAdjustmentBaseSchema,
  scalarOverrides: voicevoxAdjustmentScalarOverridesSchema,
  accentPhrases: z.array(voicevoxAccentPhraseSchema).nullable(),
  editedAt: isoUtcDateTimeSchema
});

export const voicevoxSpeakerReferenceSchema = strictObject({
  speakerName: z.string().min(1),
  speakerUuid: z.string().min(1).nullable().optional(),
  styleName: z.string().min(1)
});

export const voicevoxResolvedSpeakerSchema = strictObject({
  speakerName: z.string().min(1),
  speakerUuid: z.string().min(1),
  styleName: z.string().min(1),
  resolvedStyleId: finiteNumberSchema.int()
});

export type VoicevoxStyle = z.infer<typeof voicevoxStyleSchema>;
export type VoicevoxSpeaker = z.infer<typeof voicevoxSpeakerSchema>;
export type VoicevoxSpeakersResponse = z.infer<
  typeof voicevoxSpeakersResponseSchema
>;
export type VoicevoxAudioQuery = z.infer<typeof voicevoxAudioQuerySchema>;
export type VoicevoxMora = z.infer<typeof voicevoxMoraSchema>;
export type VoicevoxAccentPhrase = z.infer<typeof voicevoxAccentPhraseSchema>;
export type VoicevoxAdjustmentScalarOverrides = z.infer<
  typeof voicevoxAdjustmentScalarOverridesSchema
>;
export type VoicevoxAdjustmentBase = z.infer<
  typeof voicevoxAdjustmentBaseSchema
>;
export type VoicevoxAdjustmentFile = z.infer<
  typeof voicevoxAdjustmentFileSchema
>;
export type VoicevoxSpeakerReference = z.infer<
  typeof voicevoxSpeakerReferenceSchema
>;
export type VoicevoxResolvedSpeaker = z.infer<
  typeof voicevoxResolvedSpeakerSchema
>;
