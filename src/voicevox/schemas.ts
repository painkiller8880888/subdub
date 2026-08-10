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
export type VoicevoxSpeakerReference = z.infer<
  typeof voicevoxSpeakerReferenceSchema
>;
export type VoicevoxResolvedSpeaker = z.infer<
  typeof voicevoxResolvedSpeakerSchema
>;
