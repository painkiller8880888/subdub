import { z } from "zod";

import { finiteNumberSchema, strictObject } from "../schema/primitives.js";

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

const voicevoxMoraSchema = z
  .object({
    text: z.string(),
    consonant: z.string().nullable(),
    consonant_length: finiteNumberSchema.nullable(),
    vowel: z.string(),
    vowel_length: finiteNumberSchema,
    pitch: finiteNumberSchema
  })
  .passthrough();

const voicevoxAccentPhraseSchema = z
  .object({
    moras: z.array(voicevoxMoraSchema),
    accent: finiteNumberSchema,
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
export type VoicevoxSpeakerReference = z.infer<
  typeof voicevoxSpeakerReferenceSchema
>;
export type VoicevoxResolvedSpeaker = z.infer<
  typeof voicevoxResolvedSpeakerSchema
>;
