import {
  characterSchema,
  idSchema,
  scriptLineSchema,
  voiceSchema
} from "../../schema/index.js";
import type { Character, ScriptLine, Voice } from "../../schema/index.js";
import {
  VoicevoxClient,
  type VoicevoxAudioQuery,
  type VoicevoxResolvedSpeaker
} from "../../voicevox/index.js";
import {
  voicevoxEngineVersionSchema,
  voicevoxResolvedSpeakerSchema,
  type VoicevoxAdjustmentFile
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
import {
  createVoicevoxAdjustmentBaseHash,
  type VoicevoxAdjustmentBaseHashInput
} from "./adjustment-fingerprint.js";
import {
  VoicevoxAdjustmentStore,
  type VoicevoxAdjustmentStoreFileSystem
} from "./adjustment-store.js";

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

export type VoicevoxAdjustmentFingerprintInput = {
  readonly projectId: string;
  readonly lineId: string;
};

export type VoicevoxAdjustmentFingerprintProvider = {
  getChecksum(
    input: VoicevoxAdjustmentFingerprintInput
  ): Promise<string | null> | string | null;
};

export type VoicevoxQueryServiceOptions = {
  readonly client?: VoicevoxQueryClientPort;
  readonly terminologyService: VoicevoxTerminologyServicePort;
  readonly cache?: VoicevoxQueryCachePort;
  readonly workspaceRoot?: string;
  readonly fileSystem?: Partial<VoicevoxQueryCacheFileSystem>;
  readonly adjustmentStore?: VoicevoxQueryAdjustmentStorePort;
  readonly adjustmentFileSystem?: Partial<VoicevoxAdjustmentStoreFileSystem>;
  readonly adjustmentFingerprintProvider?: VoicevoxAdjustmentFingerprintProvider;
};

export type VoicevoxQueryAdjustmentStorePort = Pick<
  VoicevoxAdjustmentStore,
  "read" | "getChecksum"
> &
  Partial<Pick<VoicevoxAdjustmentStore, "readWithChecksum">>;

export type VoicevoxAdjustmentStatus =
  "current" | "needs_review" | "unsupported";

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
  readonly adjustmentChecksum?: string | null;
  readonly baseHash?: string;
  readonly adjustmentStatus?: VoicevoxAdjustmentStatus;
  readonly adjustment?: VoicevoxAdjustmentFile | null;
};

export type ResolveVoicevoxQueryInput = PrepareVoicevoxQueryInput;

export type VoicevoxQueryResolutionContext = {
  readonly voicevoxEngineVersion: string;
};

export type ResolvedVoicevoxQueryConditions = {
  readonly projectId: string;
  readonly line: ScriptLine;
  readonly character: Character;
  readonly resolvedSpeaker: VoicevoxResolvedSpeaker;
  readonly resolvedSpokenText: string;
  readonly appliedTerms: readonly AppliedTerminology[];
  readonly voicevoxEngineVersion: string;
  readonly adjustmentChecksum: string | null;
  readonly queryCacheKey: string;
  readonly cacheKey: string;
  readonly queryPath: string;
  readonly baseHash: string;
  readonly adjustmentStatus: VoicevoxAdjustmentStatus;
  readonly adjustment: VoicevoxAdjustmentFile | null;
};

export type VoicevoxQueryServiceErrorCode =
  | "VOICEVOX_QUERY_SERVICE_CACHE_REQUIRED"
  | "VOICEVOX_QUERY_SERVICE_LINE_CHARACTER_MISMATCH"
  | "VOICEVOX_QUERY_SERVICE_ADJUSTMENT_UNSUPPORTED"
  | "VOICEVOX_QUERY_SERVICE_ADJUSTMENT_NEEDS_REVIEW";

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

const noVoicevoxAdjustmentStore: Pick<
  VoicevoxAdjustmentStore,
  "read" | "getChecksum"
> &
  Partial<Pick<VoicevoxAdjustmentStore, "readWithChecksum">> = {
  read: async () => null,
  getChecksum: async () => null
};

function applyVoiceAdjustment(
  query: VoicevoxAudioQuery,
  adjustment: VoicevoxAdjustmentFile
): VoicevoxAudioQuery {
  const withScalars = {
    ...query,
    ...Object.fromEntries(
      Object.entries(adjustment.scalarOverrides).filter(
        ([, value]) => value !== undefined
      )
    )
  } as VoicevoxAudioQuery;

  if (adjustment.accentPhrases === null) {
    return withScalars;
  }

  return {
    ...withScalars,
    accent_phrases: adjustment.accentPhrases.map((phrase) => ({
      ...phrase,
      moras: phrase.moras.map((mora) => ({ ...mora })),
      pause_mora: phrase.pause_mora === null ? null : { ...phrase.pause_mora }
    }))
  };
}

export class VoicevoxQueryService {
  private readonly client: VoicevoxQueryClientPort;
  private readonly terminologyService: VoicevoxTerminologyServicePort;
  private readonly cache: VoicevoxQueryCachePort;
  private readonly adjustmentStore: VoicevoxQueryAdjustmentStorePort;
  private readonly adjustmentFingerprintProvider:
    VoicevoxAdjustmentFingerprintProvider | undefined;

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

    this.adjustmentStore =
      options.adjustmentStore ??
      (options.workspaceRoot === undefined
        ? noVoicevoxAdjustmentStore
        : new VoicevoxAdjustmentStore({
            workspaceRoot: options.workspaceRoot,
            fileSystem: options.adjustmentFileSystem
          }));
    this.adjustmentFingerprintProvider = options.adjustmentFingerprintProvider;
  }

  /**
   * Resolve every input which participates in the query cache key.
   *
   * This method deliberately does not read or write query cache files and does
   * not call /audio_query. It is shared by generation and status inspection so
   * the two paths cannot drift into different cache-key calculations.
   */
  async resolveContext(): Promise<VoicevoxQueryResolutionContext> {
    return {
      voicevoxEngineVersion: voicevoxEngineVersionSchema.parse(
        await this.client.getVersion()
      )
    };
  }

  async resolveCurrent(
    input: ResolveVoicevoxQueryInput,
    context?: VoicevoxQueryResolutionContext
  ): Promise<ResolvedVoicevoxQueryConditions> {
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
    const adjustmentAddress = {
      projectId,
      lineId: line.id
    };
    const adjustmentRead =
      this.adjustmentStore.readWithChecksum === undefined
        ? {
            adjustment: await this.adjustmentStore.read(adjustmentAddress),
            checksum: await this.adjustmentStore.getChecksum(adjustmentAddress)
          }
        : await this.adjustmentStore.readWithChecksum(adjustmentAddress);
    const adjustment = adjustmentRead?.adjustment ?? null;
    const providedAdjustmentChecksum =
      this.adjustmentFingerprintProvider === undefined
        ? null
        : await this.getAdjustmentChecksum(adjustmentAddress);
    const adjustmentChecksum =
      providedAdjustmentChecksum ?? adjustmentRead?.checksum ?? null;
    const voicevoxEngineVersion =
      context?.voicevoxEngineVersion ??
      (await this.resolveContext()).voicevoxEngineVersion;
    const baseHashInput: VoicevoxAdjustmentBaseHashInput = {
      resolvedSpokenText: resolvedText.resolvedSpokenText,
      speakerUuid: resolvedSpeaker.speakerUuid,
      styleName: resolvedSpeaker.styleName,
      resolvedStyleId: resolvedSpeaker.resolvedStyleId,
      voicevoxEngineVersion,
      characterVoice: character.voice,
      voiceOverrides: line.voiceOverrides
    };
    const baseHash = createVoicevoxAdjustmentBaseHash(baseHashInput);
    const queryCacheKeyInput: VoicevoxQueryCacheKeyInput = {
      resolvedSpokenText: resolvedText.resolvedSpokenText,
      speakerUuid: resolvedSpeaker.speakerUuid,
      styleName: resolvedSpeaker.styleName,
      resolvedStyleId: resolvedSpeaker.resolvedStyleId,
      characterVoice: character.voice,
      voiceOverrides: line.voiceOverrides,
      appliedTerms: resolvedText.appliedTerms,
      voicevoxEngineVersion,
      adjustmentChecksum: null
    };
    const queryCacheKey = createVoicevoxQueryCacheKey(queryCacheKeyInput);
    const cacheKey = createVoicevoxQueryCacheKey({
      ...queryCacheKeyInput,
      adjustmentChecksum
    });
    const adjustmentStatus: VoicevoxAdjustmentStatus =
      adjustment === null
        ? adjustmentChecksum === null
          ? "current"
          : "unsupported"
        : adjustment.base.baseHash === baseHash
          ? "current"
          : "needs_review";
    const cacheEntry: VoicevoxQueryCacheEntry = {
      projectId,
      lineId: line.id,
      cacheKey: queryCacheKey
    };

    return {
      projectId,
      line,
      character,
      resolvedSpeaker,
      resolvedSpokenText: resolvedText.resolvedSpokenText,
      appliedTerms: resolvedText.appliedTerms,
      voicevoxEngineVersion,
      adjustmentChecksum,
      queryCacheKey,
      cacheKey,
      queryPath: this.cache.getQueryPath(cacheEntry),
      baseHash,
      adjustmentStatus,
      adjustment
    };
  }

  async prepare(
    input: PrepareVoicevoxQueryInput
  ): Promise<PreparedVoicevoxQuery> {
    const current = await this.resolveCurrent(input);
    if (current.adjustmentStatus === "unsupported") {
      throw new VoicevoxQueryServiceError(
        "VOICEVOX_QUERY_SERVICE_ADJUSTMENT_UNSUPPORTED"
      );
    }
    if (current.adjustmentStatus === "needs_review") {
      throw new VoicevoxQueryServiceError(
        "VOICEVOX_QUERY_SERVICE_ADJUSTMENT_NEEDS_REVIEW"
      );
    }
    const prepared = await this.prepareUnadjustedCurrent(current);
    const adjustment = current.adjustment;
    if (adjustment === null) {
      return prepared;
    }

    return {
      ...prepared,
      query: applyVoiceAdjustment(prepared.query, adjustment)
    };
  }

  /**
   * Return the current unedited query. This is used by the editor and by the
   * stale-adjustment comparison flow; it never applies a saved adjustment.
   */
  async prepareUnadjusted(
    input: PrepareVoicevoxQueryInput
  ): Promise<PreparedVoicevoxQuery> {
    const current = await this.resolveCurrent(input);
    return this.prepareUnadjustedCurrent(current);
  }

  private async prepareUnadjustedCurrent(
    current: ResolvedVoicevoxQueryConditions
  ): Promise<PreparedVoicevoxQuery> {
    const effectiveVoice = voiceSchema.parse({
      ...current.character.voice,
      ...getDefinedVoiceOverrides(current.line.voiceOverrides)
    });
    const cacheEntry: VoicevoxQueryCacheEntry = {
      projectId: current.projectId,
      lineId: current.line.id,
      cacheKey: current.queryCacheKey
    };
    const queryPath = current.queryPath;
    const cachedQuery = await this.cache.read(cacheEntry);
    if (cachedQuery !== null) {
      return this.result({
        cached: true,
        cacheKey: current.cacheKey,
        queryPath,
        query: cachedQuery,
        resolvedText: {
          resolvedSpokenText: current.resolvedSpokenText,
          appliedTerms: current.appliedTerms
        },
        voicevoxEngineVersion: current.voicevoxEngineVersion,
        resolvedSpeaker: current.resolvedSpeaker,
        adjustmentChecksum: current.adjustmentChecksum,
        baseHash: current.baseHash,
        adjustmentStatus: current.adjustmentStatus,
        adjustment: current.adjustment
      });
    }

    const fetchedQuery = await this.client.getAudioQuery(
      current.resolvedSpokenText,
      current.resolvedSpeaker.resolvedStyleId
    );
    const query = applyVoiceSettings(fetchedQuery, effectiveVoice);
    await this.cache.write(cacheEntry, query);

    return this.result({
      cached: false,
      cacheKey: current.cacheKey,
      queryPath,
      query,
      resolvedText: {
        resolvedSpokenText: current.resolvedSpokenText,
        appliedTerms: current.appliedTerms
      },
      voicevoxEngineVersion: current.voicevoxEngineVersion,
      resolvedSpeaker: current.resolvedSpeaker,
      adjustmentChecksum: current.adjustmentChecksum,
      baseHash: current.baseHash,
      adjustmentStatus: current.adjustmentStatus,
      adjustment: current.adjustment
    });
  }

  private async getAdjustmentChecksum(input: {
    readonly projectId: string;
    readonly lineId: string;
  }): Promise<string | null> {
    const provider = this.adjustmentFingerprintProvider;
    if (provider === undefined) {
      return null;
    }
    const checksum = await provider.getChecksum(input);
    if (checksum === null || checksum === undefined) {
      return null;
    }
    if (typeof checksum !== "string" || checksum.length === 0) {
      throw new VoicevoxQueryServiceError(
        "VOICEVOX_QUERY_SERVICE_ADJUSTMENT_UNSUPPORTED"
      );
    }
    return checksum;
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
    readonly adjustmentChecksum: string | null;
    readonly baseHash: string;
    readonly adjustmentStatus: VoicevoxAdjustmentStatus;
    readonly adjustment: VoicevoxAdjustmentFile | null;
  }): PreparedVoicevoxQuery {
    return {
      cached: input.cached,
      cacheKey: input.cacheKey,
      queryPath: input.queryPath,
      query: input.query,
      resolvedSpokenText: input.resolvedText.resolvedSpokenText,
      appliedTerms: input.resolvedText.appliedTerms,
      voicevoxEngineVersion: input.voicevoxEngineVersion,
      resolvedSpeaker: input.resolvedSpeaker,
      adjustmentChecksum: input.adjustmentChecksum,
      baseHash: input.baseHash,
      adjustmentStatus: input.adjustmentStatus,
      adjustment: input.adjustment
    };
  }
}

export { VoicevoxQueryService as VoicevoxAudioQueryService };
export { VoicevoxQueryService as VoicevoxQueryPreparationService };
