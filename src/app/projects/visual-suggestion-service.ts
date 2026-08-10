import { createHash, randomUUID } from "node:crypto";

import {
  normalizeAssetSearchQuery,
  visualSearchIntentJsonSchema,
  visualSearchIntentSchema,
  visualSuggestionRequestSchema,
  visualSuggestionResultSchema,
  type AiRunLog,
  type VisualSearchIntent,
  type VisualSuggestionResult,
  type VideoProject
} from "../../schema/index.js";
import { OpenRouterAdapterError } from "../../openrouter/errors.js";
import {
  resolveModel,
  type ModelResolutionFailureReason
} from "../../openrouter/model-resolver.js";
import {
  OpenRouterChatAdapter,
  type OutlineChatResult
} from "../../openrouter/chat-adapter.js";
import { OpenRouterModelService } from "../../openrouter/model-service.js";
import {
  AssetRepository,
  type AssetRepositoryVisualSearchResult,
  type AssetTagDictionaryEntry
} from "../assets/asset-repository.js";
import {
  buildVisualSuggestionPrompt,
  type VisualSuggestionPrompt
} from "./visual-suggestion-prompt.js";
import { estimateUtf8TokenCount } from "./outline-generation-context.js";
import {
  buildVisualSuggestionPromptContext,
  resolveVisualSuggestionTarget,
  VISUAL_MEDIA_KINDS,
  type VisualSuggestionTarget
} from "./visual-suggestion-context.js";
import {
  VISUAL_SUGGESTION_ERROR_CODE,
  VisualSuggestionError
} from "./visual-suggestion-errors.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "./project-repository.js";
import { computeOutlineHash } from "./script-domain.js";

export const VISUAL_SUGGESTION_RESERVED_OUTPUT_TOKENS = 1536;
export const VISUAL_SUGGESTION_CONTEXT_ESTIMATE_METHOD =
  "UTF-8 bytes: ASCII bytes / 4 plus non-ASCII UTF-8 bytes / 2, rounded up; message framing and reserved output are added. This is a conservative estimate, not a model tokenizer.";
export const VISUAL_SUGGESTION_CANDIDATE_LIMIT = 24;

export type VisualSuggestionServiceOptions = {
  readonly repository: ProjectRepository;
  readonly assetRepository: Pick<
    AssetRepository,
    "findActiveTagDictionary" | "searchVisual"
  >;
  readonly modelService: Pick<OpenRouterModelService, "listModels">;
  readonly chatAdapter: Pick<OpenRouterChatAdapter, "complete">;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly reservedOutputTokens?: number;
};

export type VisualSuggestionServiceResult = {
  readonly data: VisualSuggestionResult;
  readonly revision: number;
};

type RunState = {
  readonly runId: string;
  readonly startRevision: number;
  readonly sourceHash: string;
  readonly inputHash: string;
  readonly startedAt: string;
  modelId: string | null;
  modelSelectionSource: AiRunLog["modelSelectionSource"];
  readonly zdr: boolean;
  readonly dataCollection: "deny";
  readonly providerFallbacks: true;
  responseModel: string | null;
  provider: string | null;
  responseTimeMs: number | null;
  httpAttemptCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  schemaValidation: AiRunLog["schemaValidation"];
  outputChecksum: string | null;
};

type ResolvedTag = VisualSuggestionResult["resolvedSearch"]["requiredTags"][number];
type TagGroup = "requiredTags" | "optionalTags" | "excludedTags";
type UnresolvedTag = VisualSuggestionResult["diagnostics"]["unresolvedTags"][number];

type ResolvedTagGroup = {
  readonly tagIds: readonly string[];
  readonly tags: readonly ResolvedTag[];
  readonly unresolvedTags: readonly UnresolvedTag[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function estimateContext(
  prompt: VisualSuggestionPrompt,
  jsonSchema: unknown,
  reservedOutputTokens: number
): number {
  return (
    estimateUtf8TokenCount(prompt.system) +
    estimateUtf8TokenCount(prompt.user) +
    estimateUtf8TokenCount(JSON.stringify(jsonSchema)) +
    32 +
    reservedOutputTokens
  );
}

function modelResolutionError(
  reason: ModelResolutionFailureReason
): VisualSuggestionError {
  const codeMap: Record<
    ModelResolutionFailureReason,
    (typeof VISUAL_SUGGESTION_ERROR_CODE)[keyof typeof VISUAL_SUGGESTION_ERROR_CODE]
  > = {
    MODEL_NOT_SELECTED: VISUAL_SUGGESTION_ERROR_CODE.modelNotSelected,
    MODEL_NOT_FOUND: VISUAL_SUGGESTION_ERROR_CODE.modelNotFound,
    MODEL_TEXT_OUTPUT_UNSUPPORTED:
      VISUAL_SUGGESTION_ERROR_CODE.modelTextOutputUnsupported,
    MODEL_STRUCTURED_OUTPUT_UNSUPPORTED:
      VISUAL_SUGGESTION_ERROR_CODE.modelStructuredOutputUnsupported,
    MODEL_EXPIRED: VISUAL_SUGGESTION_ERROR_CODE.modelExpired,
    MODEL_ZDR_ENDPOINT_UNAVAILABLE:
      VISUAL_SUGGESTION_ERROR_CODE.modelZdrUnavailable,
    // The resolver currently exposes exactly the reasons above. Keep the
    // exhaustive map explicit so a new reason cannot silently bypass this API.
  };
  return new VisualSuggestionError(
    codeMap[reason],
    422,
    "The selected OpenRouter model cannot be used for visual suggestions."
  );
}

function errorCode(error: unknown): string {
  if (error instanceof VisualSuggestionError) {
    return error.code;
  }
  if (error instanceof OpenRouterAdapterError) {
    return error.code;
  }
  if (error instanceof ProjectRepositoryError) {
    return error.code;
  }
  return "INTERNAL_SERVER_ERROR";
}

function errorDetails(error: unknown): Partial<RunState> {
  if (error instanceof OpenRouterAdapterError && error.attempts !== undefined) {
    return { httpAttemptCount: error.attempts };
  }
  return {};
}

function responseDetails(result: OutlineChatResult): Partial<RunState> {
  return {
    responseModel: result.responseModel,
    provider: result.provider,
    httpAttemptCount: result.attempts,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens
  };
}

function tagKey(value: string): string {
  return value.normalize("NFC").trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(tagKey).filter((value) => value.length > 0))];
}

function buildTagLookup(
  dictionary: readonly AssetTagDictionaryEntry[]
): Map<string, AssetTagDictionaryEntry[]> {
  const lookup = new Map<string, AssetTagDictionaryEntry[]>();
  const add = (key: string, entry: AssetTagDictionaryEntry) => {
    const entries = lookup.get(key) ?? [];
    if (!entries.some((candidate) => candidate.tagId === entry.tagId)) {
      entries.push(entry);
    }
    lookup.set(key, entries);
  };

  for (const entry of dictionary) {
    add(tagKey(entry.normalizedName), entry);
    add(tagKey(entry.canonicalName), entry);
    for (const alias of entry.aliases) {
      add(tagKey(alias.normalizedAlias), entry);
      add(tagKey(alias.alias), entry);
    }
  }
  return lookup;
}

function toResolvedTag(entry: AssetTagDictionaryEntry): ResolvedTag {
  return {
    tagId: entry.tagId,
    axis: entry.axis,
    canonicalName: entry.canonicalName
  };
}

function resolveTagGroup(
  group: TagGroup,
  values: readonly string[],
  lookup: ReadonlyMap<string, readonly AssetTagDictionaryEntry[]>
): ResolvedTagGroup {
  const tagIds: string[] = [];
  const tags: ResolvedTag[] = [];
  const unresolvedTags: UnresolvedTag[] = [];
  for (const value of uniqueStrings(values)) {
    const matches = lookup.get(tagKey(value)) ?? [];
    if (matches.length === 0) {
      unresolvedTags.push({ group, value, reason: "unknown" });
      continue;
    }
    if (matches.length > 1) {
      unresolvedTags.push({ group, value, reason: "ambiguous" });
      continue;
    }
    const match = matches[0]!;
    if (!tagIds.includes(match.tagId)) {
      tagIds.push(match.tagId);
      tags.push(toResolvedTag(match));
    }
  }
  return { tagIds, tags, unresolvedTags };
}

function normalizedFreeTextQuery(value: string): string {
  return normalizeAssetSearchQuery(value) ?? "";
}

function toSuggestionCandidates(
  search: AssetRepositoryVisualSearchResult,
  requiredTags: readonly ResolvedTag[],
  optionalTags: readonly ResolvedTag[],
  freeTextQuery: string
): VisualSuggestionResult["candidates"] {
  return search.items.map((asset) => {
    const matchedRequiredTags = requiredTags.filter((tag) =>
      asset.tagIds.includes(tag.tagId)
    );
    const matchedOptionalTags = optionalTags.filter((tag) =>
      asset.tagIds.includes(tag.tagId)
    );
    const matchReasons: string[] = [];
    if (matchedRequiredTags.length > 0) {
      matchReasons.push(
        `required tags: ${matchedRequiredTags.map((tag) => tag.canonicalName).join(", ")}`
      );
    }
    if (matchedOptionalTags.length > 0) {
      matchReasons.push(
        `optional tags: ${matchedOptionalTags.map((tag) => tag.canonicalName).join(", ")}`
      );
    }
    if (freeTextQuery.length > 0) {
      matchReasons.push(`free text: ${freeTextQuery}`);
    }
    matchReasons.push(`media kind: ${asset.kind}`);
    return {
      asset,
      matchedRequiredTags,
      matchedOptionalTags,
      matchReasons
    };
  });
}

function assertSuggestionAllowed(
  project: VideoProject,
  sourceHash: string
): void {
  const details = [];
  if (project.script.status !== "approved") {
    details.push({
      path: ["script", "status"],
      message: "an approved script is required before visual suggestions"
    });
  }
  if (project.outline.status !== "approved") {
    details.push({
      path: ["outline", "status"],
      message: "an approved outline is required before visual suggestions"
    });
  }
  if (project.outline.sourceHash !== sourceHash) {
    details.push({
      path: ["outline", "sourceHash"],
      message: "the outline is stale and must be reviewed"
    });
  }
  if (computeOutlineHash(project.outline) !== project.script.outlineHash) {
    details.push({
      path: ["script", "outlineHash"],
      message: "the approved script is stale relative to the current outline"
    });
  }
  if (details.length > 0) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.notAllowed,
      422,
      "Visual suggestions require an approved, current script.",
      details
    );
  }
}

function buildRunState(
  project: VideoProject,
  runId: string,
  inputHash: string,
  sourceHash: string,
  startedAt: string
): RunState {
  return {
    runId,
    startRevision: project.revision,
    sourceHash,
    inputHash,
    startedAt,
    modelId: null,
    modelSelectionSource: null,
    zdr: project.aiSettings.zdr,
    dataCollection: project.aiSettings.dataCollection,
    providerFallbacks: project.aiSettings.allowProviderFallbacks,
    responseModel: null,
    provider: null,
    responseTimeMs: null,
    httpAttemptCount: 0,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    schemaValidation: "not_run",
    outputChecksum: null
  };
}

function targetResponse(target: VisualSuggestionTarget) {
  return {
    startLineId: target.startLine.id,
    endLineId: target.endLine.id,
    sectionId: target.section.id,
    lineIds: [...target.lineIds]
  };
}

export class VisualSuggestionService {
  private readonly repository: ProjectRepository;
  private readonly assetRepository: VisualSuggestionServiceOptions["assetRepository"];
  private readonly modelService: Pick<OpenRouterModelService, "listModels">;
  private readonly chatAdapter: Pick<OpenRouterChatAdapter, "complete">;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly reservedOutputTokens: number;

  constructor(options: VisualSuggestionServiceOptions) {
    this.repository = options.repository;
    this.assetRepository = options.assetRepository;
    this.modelService = options.modelService;
    this.chatAdapter = options.chatAdapter;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.reservedOutputTokens = Math.max(
      1,
      Math.floor(
        options.reservedOutputTokens ?? VISUAL_SUGGESTION_RESERVED_OUTPUT_TOKENS
      )
    );
  }

  async generate(
    projectId: unknown,
    input: unknown
  ): Promise<VisualSuggestionServiceResult> {
    const request = visualSuggestionRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    if (snapshot.project.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }
    assertSuggestionAllowed(snapshot.project, snapshot.sourceHash);
    const target = resolveVisualSuggestionTarget(
      snapshot.project,
      request.startLineId,
      request.endLineId
    );
    const tagDictionary = this.assetRepository.findActiveTagDictionary();
    const context = buildVisualSuggestionPromptContext(target, tagDictionary);
    const prompt = buildVisualSuggestionPrompt(context);
    const inputHash = sha256(
      JSON.stringify({
        context,
        expectedRevision: request.expectedRevision
      })
    );
    const runId = this.createId();
    const startedAtDate = this.now();
    const run = buildRunState(
      snapshot.project,
      runId,
      inputHash,
      snapshot.sourceHash,
      startedAtDate.toISOString()
    );
    let runStarted = false;

    try {
      await this.writeStartedRunLog(snapshot.project, run);
      runStarted = true;

      const models = await this.modelService.listModels();
      const resolution = resolveModel({
        settings: snapshot.project.aiSettings,
        taskKind: "visual_search_intent",
        runOverride: request.modelId,
        models: models.models,
        now: this.now
      });
      if (!resolution.ok) {
        throw modelResolutionError(resolution.reason);
      }
      run.modelId = resolution.modelId;
      run.modelSelectionSource = resolution.source;

      const estimatedTokens = estimateContext(
        prompt,
        visualSearchIntentJsonSchema,
        this.reservedOutputTokens
      );
      if (estimatedTokens > resolution.capabilities.contextLength) {
        throw new VisualSuggestionError(
          VISUAL_SUGGESTION_ERROR_CODE.contextLengthExceeded,
          422,
          `The visual suggestion input exceeds the selected model context length. ${VISUAL_SUGGESTION_CONTEXT_ESTIMATE_METHOD}`,
          [
            {
              path: ["context"],
              message: `Estimated ${estimatedTokens} tokens for a ${resolution.capabilities.contextLength}-token context; output reservation ${this.reservedOutputTokens}.`
            }
          ]
        );
      }

      const response = await this.chatAdapter.complete({
        modelId: resolution.modelId,
        schemaName: "subdub_visual_search_intent",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        jsonSchema: visualSearchIntentJsonSchema as unknown as Record<
          string,
          unknown
        >,
        maxTokens: this.reservedOutputTokens,
        zdr: snapshot.project.aiSettings.zdr,
        dataCollection: snapshot.project.aiSettings.dataCollection,
        allowProviderFallbacks: snapshot.project.aiSettings.allowProviderFallbacks
      });
      Object.assign(run, responseDetails(response));
      run.responseTimeMs = Math.max(
        0,
        this.now().getTime() - startedAtDate.getTime()
      );

      const intentResult = visualSearchIntentSchema.safeParse(
        response.candidate
      );
      if (!intentResult.success) {
        run.schemaValidation = "failed";
        throw new VisualSuggestionError(
          VISUAL_SUGGESTION_ERROR_CODE.schemaInvalid,
          502,
          "OpenRouter returned a visual search intent that does not match the generation schema."
        );
      }
      run.schemaValidation = "passed";
      const intent = intentResult.data;
      run.outputChecksum = sha256(JSON.stringify(intent));

      const resolvedTagDictionary =
        this.assetRepository.findActiveTagDictionary();
      const resolved = resolveIntent(intent, resolvedTagDictionary);
      const freeTextQuery = normalizedFreeTextQuery(intent.freeTextQuery);
      const search = resolved.requiredTagResolutionFailed
        ? { items: [], total: 0 }
        : this.assetRepository.searchVisual({
            requiredTagIds: resolved.required.tagIds,
            optionalTagIds: resolved.optional.tagIds,
            excludedTagIds: resolved.excluded.tagIds,
            kinds: [...intent.mediaKinds],
            q: freeTextQuery.length > 0 ? freeTextQuery : undefined,
            limit: VISUAL_SUGGESTION_CANDIDATE_LIMIT
          });
      const safeSearch = {
        ...search,
        items: search.items.filter(
          (asset) =>
            asset.status === "active" &&
            (VISUAL_MEDIA_KINDS as readonly string[]).includes(asset.kind)
        )
      };
      const candidates = toSuggestionCandidates(
        safeSearch,
        resolved.required.tags,
        resolved.optional.tags,
        freeTextQuery
      );
      const result = visualSuggestionResultSchema.parse({
        runId,
        target: targetResponse(target),
        aiIntent: intent,
        resolvedSearch: {
          requiredTags: resolved.required.tags,
          optionalTags: resolved.optional.tags,
          excludedTags: resolved.excluded.tags,
          mediaKinds: [...intent.mediaKinds],
          freeTextQuery
        },
        diagnostics: {
          unresolvedTags: resolved.unresolvedTags,
          requiredTagResolutionFailed: resolved.requiredTagResolutionFailed,
          candidateCount: candidates.length
        },
        candidates
      });

      const saved = await this.repository.save(
        projectId,
        {
          ...snapshot.project,
          visuals: {
            ...snapshot.project.visuals,
            suggestionRunIds: [
              ...snapshot.project.visuals.suggestionRunIds,
              runId
            ]
          }
        },
        request.expectedRevision
      );
      await this.tryFinalizeRunLog(saved, run, "succeeded", null);
      return { data: result, revision: saved.revision };
    } catch (error) {
      Object.assign(run, errorDetails(error));
      if (run.responseTimeMs === null) {
        run.responseTimeMs = Math.max(
          0,
          this.now().getTime() - startedAtDate.getTime()
        );
      }
      if (runStarted) {
        await this.tryFinalizeRunLog(
          snapshot.project,
          run,
          "failed",
          errorCode(error)
        );
      }
      throw error;
    }
  }

  private async writeStartedRunLog(
    project: VideoProject,
    run: RunState
  ): Promise<void> {
    await this.writeRunLog(project, run, "running", null);
  }

  private async tryFinalizeRunLog(
    project: VideoProject,
    run: RunState,
    status: "succeeded" | "failed",
    failureCode: string | null
  ): Promise<void> {
    try {
      await this.writeRunLog(project, run, status, failureCode);
    } catch {
      // Keep the running log as a diagnostic record when finalization fails.
    }
  }

  private async writeRunLog(
    project: VideoProject,
    run: RunState,
    status: AiRunLog["status"],
    failureCode: string | null
  ): Promise<void> {
    const runLog: AiRunLog = {
      runId: run.runId,
      kind: "ai",
      taskKind: "visual_search_intent",
      projectId: project.metadata.id,
      startRevision: run.startRevision,
      sourceHash: run.sourceHash,
      inputHash: run.inputHash,
      startedAt: run.startedAt,
      completedAt: status === "running" ? null : this.now().toISOString(),
      status,
      modelId: run.modelId,
      modelSelectionSource: run.modelSelectionSource,
      responseModel: run.responseModel,
      provider: run.provider,
      zdr: run.zdr,
      dataCollection: run.dataCollection,
      providerFallbacks: run.providerFallbacks,
      responseTimeMs: run.responseTimeMs,
      httpAttemptCount: run.httpAttemptCount,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      totalTokens: run.totalTokens,
      schemaValidation: run.schemaValidation,
      outputChecksum: status === "succeeded" ? run.outputChecksum : null,
      errorCode: failureCode,
      imageInput: false,
      tools: false
    };
    await this.repository.writeRunLog(project.metadata.id, run.runId, runLog);
  }
}

function resolveIntent(
  intent: VisualSearchIntent,
  dictionary: readonly AssetTagDictionaryEntry[]
): {
  readonly required: ResolvedTagGroup;
  readonly optional: ResolvedTagGroup;
  readonly excluded: ResolvedTagGroup;
  readonly unresolvedTags: readonly UnresolvedTag[];
  readonly requiredTagResolutionFailed: boolean;
} {
  const lookup = buildTagLookup(dictionary);
  const required = resolveTagGroup("requiredTags", intent.requiredTags, lookup);
  const optional = resolveTagGroup("optionalTags", intent.optionalTags, lookup);
  const excluded = resolveTagGroup("excludedTags", intent.excludedTags, lookup);
  return {
    required,
    optional,
    excluded,
    unresolvedTags: [
      ...required.unresolvedTags,
      ...optional.unresolvedTags,
      ...excluded.unresolvedTags
    ],
    requiredTagResolutionFailed: required.unresolvedTags.length > 0
  };
}
