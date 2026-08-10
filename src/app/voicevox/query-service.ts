import {
  characterSchema,
  idSchema,
  scriptLineSchema,
  voiceSchema
} from "../../schema/index.js";
import type { ScriptLine, Voice } from "../../schema/index.js";
import {
  VoicevoxClient,
  type VoicevoxAudioQuery,
  type VoicevoxResolvedSpeaker
} from "../../voicevox/index.js";
import {
  voicevoxEngineVersionSchema,
  voicevoxResolvedSpeakerSchema
} from "../../voicevox/schemas.js";
import type { TerminologyService } from "../terminology/terminology-service.js";
import type {
  AppliedTerminology,
  ResolvedSpokenText
} from "../terminology/spoken-text-resolver.js";
import {
  createVoicevoxQueryCacheKey,
  type VoicevoxQueryCacheKeyInput
} from "./query-cache-key.js";
import {
  VoicevoxQueryCache,
  type VoicevoxQueryCacheEntry,
  type VoicevoxQueryCacheFileSystem
} from "./query-cache.js";

export type VoicevoxQueryClientPort = Pick<
  VoicevoxClient,
  "getAudioQuery" | "getVersion"
>;

export type VoicevoxTerminologyServicePort = Pick<
  TerminologyService,
  "preview"
>;

export type VoicevoxQueryCachePort = {
  getQueryPath(entry: VoicevoxQueryCacheEntry): string;
  read(entry: VoicevoxQueryCacheEntry): Promise<VoicevoxAudioQuery | null>;
  write(entry: VoicevoxQueryCacheEntry, query: unknown): Promise<void>;
};

export type VoicevoxQueryServiceOptions = {
  readonly client?: VoicevoxQueryClientPort;
  readonly terminologyService: VoicevoxTerminologyServicePort;
  readonly cache?: VoicevoxQueryCachePort;
  readonly workspaceRoot?: string;
  readonly fileSystem?: Partial<VoicevoxQueryCacheFileSystem>;
};

export type PrepareVoicevoxQueryInput = {
  readonly projectId: unknown;
  readonly line: unknown;
  readonly character: unknown;
  readonly resolvedSpeaker: unknown;
};

export type PreparedVoicevoxQuery = {
  readonly cached: boolean;
  readonly cacheKey: string;
  readonly queryPath: string;
  readonly query: VoicevoxAudioQuery;
  readonly resolvedSpokenText: string;
  readonly appliedTerms: readonly AppliedTerminology[];
  readonly voicevoxEngineVersion: string;
  readonly resolvedSpeaker: VoicevoxResolvedSpeaker;
};

export type VoicevoxQueryServiceErrorCode =
  | "VOICEVOX_QUERY_SERVICE_CACHE_REQUIRED"
  | "VOICEVOX_QUERY_SERVICE_LINE_CHARACTER_MISMATCH";

export class VoicevoxQueryServiceError extends Error {
  readonly code: VoicevoxQueryServiceErrorCode;

  constructor(code: VoicevoxQueryServiceErrorCode) {
    super(code);
    this.name = "VoicevoxQueryServiceError";
    this.code = code;
  }
}

function applyVoiceSettings(
  query: VoicevoxAudioQuery,
  voice: Voice
): VoicevoxAudioQuery {
  return {
    ...query,
    speedScale: voice.speedScale,
    pitchScale: voice.pitchScale,
    intonationScale: voice.intonationScale,
    volumeScale: voice.volumeScale,
    prePhonemeLength: voice.prePhonemeLength,
    postPhonemeLength: voice.postPhonemeLength
  };
}

function getDefinedVoiceOverrides(
  voiceOverrides: Partial<Voice>
): Partial<Voice> {
  return Object.fromEntries(
    Object.entries(voiceOverrides).filter(([, value]) => value !== undefined)
  );
}

function normalizeResolvedText(result: ResolvedSpokenText): ResolvedSpokenText {
  return {
    resolvedSpokenText: result.resolvedSpokenText.normalize("NFC"),
    appliedTerms: result.appliedTerms
  };
}

export class VoicevoxQueryService {
  private readonly client: VoicevoxQueryClientPort;
  private readonly terminologyService: VoicevoxTerminologyServicePort;
  private readonly cache: VoicevoxQueryCachePort;

  constructor(options: VoicevoxQueryServiceOptions) {
    this.client = options.client ?? new VoicevoxClient();
    this.terminologyService = options.terminologyService;
    if (options.cache !== undefined) {
      this.cache = options.cache;
    } else if (options.workspaceRoot !== undefined) {
      this.cache = new VoicevoxQueryCache({
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.fileSystem
      });
    } else {
      throw new VoicevoxQueryServiceError(
        "VOICEVOX_QUERY_SERVICE_CACHE_REQUIRED"
      );
    }
  }

  async prepare(
    input: PrepareVoicevoxQueryInput
  ): Promise<PreparedVoicevoxQuery> {
    const projectId = idSchema.parse(input.projectId);
    const line = scriptLineSchema.parse(input.line);
    const character = characterSchema.parse(input.character);
    const resolvedSpeaker = voicevoxResolvedSpeakerSchema.parse(
      input.resolvedSpeaker
    );

    if (line.speakerId !== character.id) {
      throw new VoicevoxQueryServiceError(
        "VOICEVOX_QUERY_SERVICE_LINE_CHARACTER_MISMATCH"
      );
    }

    const resolvedText = normalizeResolvedText(this.resolveSpokenText(line));
    const effectiveVoice = voiceSchema.parse({
      ...character.voice,
      ...getDefinedVoiceOverrides(line.voiceOverrides)
    });
    const voicevoxEngineVersion = voicevoxEngineVersionSchema.parse(
      await this.client.getVersion()
    );
    const cacheKeyInput: VoicevoxQueryCacheKeyInput = {
      resolvedSpokenText: resolvedText.resolvedSpokenText,
      speakerUuid: resolvedSpeaker.speakerUuid,
      styleName: resolvedSpeaker.styleName,
      resolvedStyleId: resolvedSpeaker.resolvedStyleId,
      characterVoice: character.voice,
      voiceOverrides: line.voiceOverrides,
      appliedTerms: resolvedText.appliedTerms,
      voicevoxEngineVersion
    };
    const cacheKey = createVoicevoxQueryCacheKey(cacheKeyInput);
    const cacheEntry: VoicevoxQueryCacheEntry = {
      projectId,
      lineId: line.id,
      cacheKey
    };
    const queryPath = this.cache.getQueryPath(cacheEntry);
    const cachedQuery = await this.cache.read(cacheEntry);
    if (cachedQuery !== null) {
      return this.result({
        cached: true,
        cacheKey,
        queryPath,
        query: cachedQuery,
        resolvedText,
        voicevoxEngineVersion,
        resolvedSpeaker
      });
    }

    const fetchedQuery = await this.client.getAudioQuery(
      resolvedText.resolvedSpokenText,
      resolvedSpeaker.resolvedStyleId
    );
    const query = applyVoiceSettings(fetchedQuery, effectiveVoice);
    await this.cache.write(cacheEntry, query);

    return this.result({
      cached: false,
      cacheKey,
      queryPath,
      query,
      resolvedText,
      voicevoxEngineVersion,
      resolvedSpeaker
    });
  }

  private resolveSpokenText(line: ScriptLine): ResolvedSpokenText {
    return this.terminologyService.preview({
      spokenText: line.spokenText,
      pronunciation: line.pronunciation
    });
  }

  private result(input: {
    readonly cached: boolean;
    readonly cacheKey: string;
    readonly queryPath: string;
    readonly query: VoicevoxAudioQuery;
    readonly resolvedText: ResolvedSpokenText;
    readonly voicevoxEngineVersion: string;
    readonly resolvedSpeaker: VoicevoxResolvedSpeaker;
  }): PreparedVoicevoxQuery {
    return {
      cached: input.cached,
      cacheKey: input.cacheKey,
      queryPath: input.queryPath,
      query: input.query,
      resolvedSpokenText: input.resolvedText.resolvedSpokenText,
      appliedTerms: input.resolvedText.appliedTerms,
      voicevoxEngineVersion: input.voicevoxEngineVersion,
      resolvedSpeaker: input.resolvedSpeaker
    };
  }
}

export { VoicevoxQueryService as VoicevoxAudioQueryService };
export { VoicevoxQueryService as VoicevoxQueryPreparationService };
