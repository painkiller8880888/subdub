import {
  characterSchema,
  idSchema,
  positiveIntegerSchema,
  scriptLineSchema
} from "../../schema/index.js";
import { VoicevoxClient } from "../../voicevox/index.js";
import {
  voicevoxAudioQuerySchema,
  voicevoxResolvedSpeakerSchema
} from "../../voicevox/schemas.js";
import {
  VoicevoxAudioStore,
  type VoicevoxAudioStoreFileSystem,
  type VoicevoxAudioStoreInput
} from "./audio-store.js";
import {
  VoicevoxQueryService,
  type PreparedVoicevoxQuery
} from "./query-service.js";

export type VoicevoxAudioQueryServicePort = Pick<
  VoicevoxQueryService,
  "prepare"
>;

export type VoicevoxSynthesisClientPort = Pick<VoicevoxClient, "synthesize">;

export type VoicevoxAudioStorePort = Pick<VoicevoxAudioStore, "save">;

export type GenerateVoicevoxAudioInput = {
  readonly projectId: unknown;
  readonly line: unknown;
  readonly character: unknown;
  readonly resolvedSpeaker: unknown;
  readonly sectionOrder: unknown;
  readonly lineOrder: unknown;
};

export type VoicevoxAudioServiceOptions = {
  readonly queryService: VoicevoxAudioQueryServicePort;
  readonly client?: VoicevoxSynthesisClientPort;
  readonly audioStore?: VoicevoxAudioStorePort;
  readonly store?: VoicevoxAudioStorePort;
  readonly workspaceRoot?: string;
  readonly fileSystem?: Partial<VoicevoxAudioStoreFileSystem>;
  readonly now?: () => Date;
};

export type VoicevoxAudioServiceErrorCode =
  | "VOICEVOX_AUDIO_SERVICE_STORE_REQUIRED"
  | "VOICEVOX_AUDIO_SERVICE_LINE_CHARACTER_MISMATCH";

export class VoicevoxAudioServiceError extends Error {
  readonly code: VoicevoxAudioServiceErrorCode;

  constructor(code: VoicevoxAudioServiceErrorCode) {
    super(code);
    this.name = "VoicevoxAudioServiceError";
    this.code = code;
  }
}

export class VoicevoxAudioService {
  private readonly queryService: VoicevoxAudioQueryServicePort;
  private readonly client: VoicevoxSynthesisClientPort;
  private readonly audioStore: VoicevoxAudioStorePort;

  constructor(options: VoicevoxAudioServiceOptions) {
    this.queryService = options.queryService;
    this.client = options.client ?? new VoicevoxClient();

    const suppliedStore = options.audioStore ?? options.store;
    if (suppliedStore !== undefined) {
      this.audioStore = suppliedStore;
    } else if (options.workspaceRoot !== undefined) {
      this.audioStore = new VoicevoxAudioStore({
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.fileSystem,
        now: options.now
      });
    } else {
      throw new VoicevoxAudioServiceError(
        "VOICEVOX_AUDIO_SERVICE_STORE_REQUIRED"
      );
    }
  }

  async generate(input: GenerateVoicevoxAudioInput) {
    const projectId = idSchema.parse(input.projectId);
    const line = scriptLineSchema.parse(input.line);
    const character = characterSchema.parse(input.character);
    const resolvedSpeaker = voicevoxResolvedSpeakerSchema.parse(
      input.resolvedSpeaker
    );
    const sectionOrder = positiveIntegerSchema.parse(input.sectionOrder);
    const lineOrder = positiveIntegerSchema.parse(input.lineOrder);

    if (line.speakerId !== character.id) {
      throw new VoicevoxAudioServiceError(
        "VOICEVOX_AUDIO_SERVICE_LINE_CHARACTER_MISMATCH"
      );
    }

    const prepared = await this.queryService.prepare({
      projectId,
      line,
      character,
      resolvedSpeaker
    });
    const parsedQuery = voicevoxAudioQuerySchema.parse(prepared.query);
    const preparedSpeaker = voicevoxResolvedSpeakerSchema.parse(
      prepared.resolvedSpeaker
    );
    const preparedWithParsedQuery: PreparedVoicevoxQuery = {
      ...prepared,
      query: parsedQuery
    };
    const audioBytes = await this.client.synthesize(
      parsedQuery,
      preparedSpeaker.resolvedStyleId
    );
    const storeInput: VoicevoxAudioStoreInput = {
      projectId,
      lineId: line.id,
      sectionOrder,
      lineOrder,
      prepared: preparedWithParsedQuery,
      audioBytes
    };
    return this.audioStore.save(storeInput);
  }

  async generateLine(input: GenerateVoicevoxAudioInput) {
    return this.generate(input);
  }
}

export { VoicevoxAudioService as VoicevoxAudioGenerationService };
