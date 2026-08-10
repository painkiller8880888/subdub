import { VoicevoxResolutionError, VOICEVOX_ERROR_CODE } from "./errors.js";
import type {
  VoicevoxResolvedSpeaker,
  VoicevoxSpeaker,
  VoicevoxSpeakerReference
} from "./schemas.js";

export function resolveVoicevoxSpeaker(
  speakers: readonly VoicevoxSpeaker[],
  reference: VoicevoxSpeakerReference
): VoicevoxResolvedSpeaker {
  const matchingSpeakers =
    reference.speakerUuid !== undefined && reference.speakerUuid !== null
      ? speakers.filter(
          (speaker) => speaker.speaker_uuid === reference.speakerUuid
        )
      : speakers.filter((speaker) => speaker.name === reference.speakerName);

  if (matchingSpeakers.length === 0) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.speakerNotFound);
  }

  if (matchingSpeakers.length !== 1) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.speakerAmbiguous);
  }

  const speaker = matchingSpeakers[0];
  if (speaker === undefined) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.speakerNotFound);
  }

  const matchingStyles = speaker.styles.filter(
    (style) => style.name === reference.styleName
  );

  if (matchingStyles.length === 0) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.styleNotFound);
  }

  if (matchingStyles.length !== 1) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.styleAmbiguous);
  }

  const style = matchingStyles[0];
  if (style === undefined) {
    throw new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.styleNotFound);
  }

  return {
    speakerName: speaker.name,
    speakerUuid: speaker.speaker_uuid,
    styleName: style.name,
    resolvedStyleId: style.id
  };
}

export function resolveVoicevoxSpeakers(
  speakers: readonly VoicevoxSpeaker[],
  references: readonly VoicevoxSpeakerReference[]
): readonly VoicevoxResolvedSpeaker[] {
  return references.map((reference) =>
    resolveVoicevoxSpeaker(speakers, reference)
  );
}
