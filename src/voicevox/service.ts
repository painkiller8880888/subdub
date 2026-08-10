import {
  VoicevoxAdapterError,
  VoicevoxResolutionError,
  type VoicevoxFailureCode
} from "./errors.js";
import { VoicevoxClient } from "./client.js";
import { resolveVoicevoxSpeakers } from "./resolver.js";
import {
  voicevoxSpeakerReferenceSchema,
  type VoicevoxResolvedSpeaker,
  type VoicevoxSpeakerReference
} from "./schemas.js";

export const DEFAULT_VOICEVOX_SPEAKER_REFERENCES = [
  { speakerName: "四国めたん", styleName: "ノーマル" },
  { speakerName: "ずんだもん", styleName: "ノーマル" }
] as const satisfies readonly VoicevoxSpeakerReference[];

export type VoicevoxAvailableStatus = {
  readonly available: true;
  readonly speakers: readonly VoicevoxResolvedSpeaker[];
};

export type VoicevoxUnavailableStatus = {
  readonly available: false;
  readonly reason: VoicevoxFailureCode;
};

export type VoicevoxStatus =
  VoicevoxAvailableStatus | VoicevoxUnavailableStatus;

export type VoicevoxClientPort = Pick<VoicevoxClient, "getSpeakers">;

export type VoicevoxStatusServiceOptions = {
  readonly client?: VoicevoxClientPort;
  readonly speakerReferences?: readonly VoicevoxSpeakerReference[];
};

export class VoicevoxStatusService {
  private readonly client: VoicevoxClientPort;
  private readonly speakerReferences: readonly VoicevoxSpeakerReference[];

  constructor(options: VoicevoxStatusServiceOptions = {}) {
    this.client = options.client ?? new VoicevoxClient();
    this.speakerReferences = (
      options.speakerReferences ?? DEFAULT_VOICEVOX_SPEAKER_REFERENCES
    ).map((reference) => voicevoxSpeakerReferenceSchema.parse(reference));
  }

  async getStatus(): Promise<VoicevoxStatus> {
    try {
      const speakers = await this.client.getSpeakers();
      return {
        available: true,
        speakers: resolveVoicevoxSpeakers(speakers, this.speakerReferences)
      };
    } catch (error) {
      if (
        error instanceof VoicevoxAdapterError ||
        error instanceof VoicevoxResolutionError
      ) {
        return {
          available: false,
          reason: error.code
        };
      }
      throw error;
    }
  }
}

export function createVoicevoxStatusService(
  options: VoicevoxStatusServiceOptions = {}
): VoicevoxStatusService {
  return new VoicevoxStatusService(options);
}
