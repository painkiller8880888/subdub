import { createHash, randomUUID } from "node:crypto";

import {
  outlineGenerateRequestSchema,
  outlineGenerationCandidateSchema,
  outlineGenerationJsonSchema,
  outlineSchema,
  videoProjectSchema,
  type AiRunLog,
  type Outline,
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
  estimateOutlineGenerationContext,
  OUTLINE_GENERATION_CONTEXT_ESTIMATE_METHOD,
  OUTLINE_GENERATION_RESERVED_OUTPUT_TOKENS
} from "./outline-generation-context.js";
import {
  OUTLINE_GENERATION_ERROR_CODE,
  OutlineGenerationError
} from "./outline-generation-errors.js";
import { ProjectRepository, ProjectRepositoryError } from "./project-repository.js";
import { buildOutlineGenerationPrompt } from "./outline-prompt.js";

export type OutlineGenerationServiceOptions = {
  readonly repository: ProjectRepository;
  readonly modelService: Pick<OpenRouterModelService, "listModels">;
  readonly chatAdapter: Pick<OpenRouterChatAdapter, "complete">;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly reservedOutputTokens?: number;
};

type RunState = {
  runId: string;
  startRevision: number;
  sourceHash: string;
  inputHash: string;
  startedAt: string;
  modelId: string | null;
  modelSelectionSource: AiRunLog["modelSelectionSource"];
  zdr: boolean;
  dataCollection: "deny";
  providerFallbacks: true;
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function resolutionError(
  reason: ModelResolutionFailureReason
): OutlineGenerationError {
  const codeMap: Record<
    ModelResolutionFailureReason,
    (typeof OUTLINE_GENERATION_ERROR_CODE)[keyof typeof OUTLINE_GENERATION_ERROR_CODE]
  > = {
    MODEL_NOT_SELECTED: OUTLINE_GENERATION_ERROR_CODE.modelNotSelected,
    MODEL_NOT_FOUND: OUTLINE_GENERATION_ERROR_CODE.modelNotFound,
    MODEL_TEXT_OUTPUT_UNSUPPORTED:
      OUTLINE_GENERATION_ERROR_CODE.modelTextOutputUnsupported,
    MODEL_STRUCTURED_OUTPUT_UNSUPPORTED:
      OUTLINE_GENERATION_ERROR_CODE.modelStructuredOutputUnsupported,
    MODEL_EXPIRED: OUTLINE_GENERATION_ERROR_CODE.modelExpired,
    MODEL_ZDR_ENDPOINT_UNAVAILABLE:
      OUTLINE_GENERATION_ERROR_CODE.modelZdrUnavailable
  };
  return new OutlineGenerationError(
    codeMap[reason],
    422,
    "The selected OpenRouter model cannot be used for outline generation."
  );
}

function errorCode(error: unknown): string {
  if (error instanceof OutlineGenerationError) {
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

function hasExistingOutline(project: VideoProject): boolean {
  return (
    project.outline.sections.length > 0 ||
    project.outline.openQuestions.length > 0 ||
    project.outline.generationRunId !== null ||
    project.outline.status !== "draft"
  );
}

function errorDetails(error: unknown): Partial<RunState> {
  if (error instanceof OpenRouterAdapterError && error.attempts !== undefined) {
    return { httpAttemptCount: error.attempts };
  }
  return {};
}

function markdownHeadingPaths(markdown: string): ReadonlySet<string> {
  const paths = new Set<string>();
  const stack: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  const addHeading = (level: number, rawTitle: string) => {
    const title = rawTitle.replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (title.length === 0) {
      return;
    }
    stack.splice(level - 1);
    stack[level - 1] = title;
    paths.add(JSON.stringify(stack.slice(0, level)));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }

    const atxMatch = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    if (atxMatch !== null) {
      addHeading(atxMatch[1].length, atxMatch[2]);
      continue;
    }

    const setextMatch = /^[ \t]{0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1] ?? "");
    if (setextMatch !== null && line.trim().length > 0) {
      addHeading(setextMatch[1][0] === "=" ? 1 : 2, line);
      index += 1;
    }
  }
  return paths;
}

function validateCandidateStructure(
  candidate: ReturnType<typeof outlineGenerationCandidateSchema.parse>,
  markdown: string
): void {
  if (
    candidate.sections.length < 3 ||
    candidate.sections[0]?.role !== "intro" ||
    candidate.sections.at(-1)?.role !== "outro" ||
    candidate.sections.slice(1, -1).some((section) => section.role !== "main")
  ) {
    throw new OutlineGenerationError(
      OUTLINE_GENERATION_ERROR_CODE.orderInvalid,
      502,
      "OpenRouter returned an outline with an invalid section order."
    );
  }

  const headings = markdownHeadingPaths(markdown);
  for (const section of candidate.sections) {
    for (const sourceRef of section.sourceRefs) {
      if (
        sourceRef.headingPath.length > 0 &&
        !headings.has(JSON.stringify(sourceRef.headingPath))
      ) {
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.sourceReferenceInvalid,
          502,
          "OpenRouter returned a source reference that is not in the Markdown."
        );
      }
    }
  }
}

function toOutline(
  candidate: ReturnType<typeof outlineGenerationCandidateSchema.parse>,
  project: VideoProject,
  sourceHash: string,
  runId: string
): Outline {
  let questionNumber = 0;
  const makeQuestion = (question: string, scope: string) => {
    questionNumber += 1;
    return {
      id: `${runId}-${scope}-question-${questionNumber}`,
      question,
      resolution: null,
      status: "open" as const
    };
  };

  const outline: Outline = {
    status: "needs_review",
    sourceHash,
    generationRunId: runId,
    openQuestions: candidate.openQuestions.map((question) =>
      makeQuestion(question.question, "outline")
    ),
    sections: candidate.sections.map((section, index) => ({
      id: `${runId}-section-${index + 1}`,
      order: index + 1,
      role: section.role,
      title: section.title,
      overview: section.overview,
      keyPoints: [...section.keyPoints],
      targetDurationSec: section.targetDurationSec,
      sourceRefs: section.sourceRefs.map((sourceRef) => ({
        sourceId: project.source.id,
        headingPath: [...sourceRef.headingPath]
      })),
      openQuestions: section.openQuestions.map((question) =>
        makeQuestion(question.question, `section-${index + 1}`)
      ),
      humanDirectives: {
        requiredItems: [],
        prohibitedItems: [],
        scriptConstraints: []
      },
      lockedFields: []
    }))
  };

  return outlineSchema.parse(outline);
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

export class OutlineGenerationService {
  private readonly repository: ProjectRepository;
  private readonly modelService: Pick<OpenRouterModelService, "listModels">;
  private readonly chatAdapter: Pick<OpenRouterChatAdapter, "complete">;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly reservedOutputTokens: number | undefined;

  constructor(options: OutlineGenerationServiceOptions) {
    this.repository = options.repository;
    this.modelService = options.modelService;
    this.chatAdapter = options.chatAdapter;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.reservedOutputTokens = options.reservedOutputTokens;
  }

  async generate(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineGenerateRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    const runId = this.createId();
    const startedAtDate = this.now();
    const inputHash = sha256(
      JSON.stringify({
        markdown: snapshot.markdown,
        brief: snapshot.project.brief,
        aiSettings: snapshot.project.aiSettings,
        expectedRevision: request.expectedRevision
      })
    );
    const run: RunState = {
      runId,
      startRevision: snapshot.project.revision,
      sourceHash: snapshot.sourceHash,
      inputHash,
      startedAt: startedAtDate.toISOString(),
      modelId: null,
      modelSelectionSource: null,
      zdr: snapshot.project.aiSettings.zdr,
      dataCollection: snapshot.project.aiSettings.dataCollection,
      providerFallbacks: snapshot.project.aiSettings.allowProviderFallbacks,
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

    let runStarted = false;
    try {
      await this.writeStartedRunLog(snapshot.project, run);
      runStarted = true;

      if (snapshot.project.revision !== request.expectedRevision) {
        throw new ProjectRepositoryError(
          "PROJECT_REVISION_CONFLICT",
          409,
          "The project revision does not match the expected revision."
        );
      }
      if (hasExistingOutline(snapshot.project)) {
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.alreadyExists,
          409,
          "An existing outline must be explicitly cleared before generation."
        );
      }

      const models = await this.modelService.listModels();
      const resolution = resolveModel({
        settings: snapshot.project.aiSettings,
        taskKind: "outline_generation",
        runOverride: request.modelId,
        models: models.models,
        now: this.now
      });
      if (!resolution.ok) {
        throw resolutionError(resolution.reason);
      }
      run.modelId = resolution.modelId;
      run.modelSelectionSource = resolution.source;

      const prompt = buildOutlineGenerationPrompt({
        markdown: snapshot.markdown,
        brief: snapshot.project.brief
      });
      const estimate = estimateOutlineGenerationContext({
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        jsonSchema: outlineGenerationJsonSchema,
        reservedOutputTokens: this.reservedOutputTokens
      });
      if (estimate.estimatedTokens > resolution.capabilities.contextLength) {
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.contextLengthExceeded,
          422,
          `The outline input exceeds the selected model context length. ${OUTLINE_GENERATION_CONTEXT_ESTIMATE_METHOD}`,
          [
            {
              path: ["context"],
              message: `Estimated ${estimate.estimatedTokens} tokens for a ${resolution.capabilities.contextLength}-token context; output reservation ${estimate.reservedOutputTokens}.`
            }
          ]
        );
      }

      const response = await this.chatAdapter.complete({
        modelId: resolution.modelId,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        jsonSchema: outlineGenerationJsonSchema as unknown as Record<
          string,
          unknown
        >,
        maxTokens:
          estimate.reservedOutputTokens ??
          OUTLINE_GENERATION_RESERVED_OUTPUT_TOKENS,
        zdr: snapshot.project.aiSettings.zdr,
        dataCollection: snapshot.project.aiSettings.dataCollection,
        allowProviderFallbacks: snapshot.project.aiSettings.allowProviderFallbacks
      });
      Object.assign(run, responseDetails(response));
      run.responseTimeMs = Math.max(0, this.now().getTime() - startedAtDate.getTime());

      const candidateResult = outlineGenerationCandidateSchema.safeParse(
        response.candidate
      );
      if (!candidateResult.success) {
        run.schemaValidation = "failed";
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.schemaInvalid,
          502,
          "OpenRouter returned an outline that does not match the generation schema."
        );
      }
      run.schemaValidation = "failed";
      validateCandidateStructure(candidateResult.data, snapshot.markdown);
      let outline: Outline;
      try {
        outline = toOutline(
          candidateResult.data,
          snapshot.project,
          snapshot.sourceHash,
          runId
        );
      } catch {
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.schemaInvalid,
          502,
          "The generated outline could not be validated."
        );
      }
      const projectCandidate = videoProjectSchema.safeParse({
        ...snapshot.project,
        outline
      });
      if (!projectCandidate.success) {
        run.schemaValidation = "failed";
        throw new OutlineGenerationError(
          OUTLINE_GENERATION_ERROR_CODE.schemaInvalid,
          502,
          "The generated outline could not be applied to the project schema."
        );
      }
      run.schemaValidation = "passed";
      run.outputChecksum = sha256(JSON.stringify(outline));

      const saved = await this.repository.saveOutline(
        projectId,
        outline,
        request.expectedRevision
      );
      await this.tryFinalizeRunLog(saved, run, "succeeded", null);
      return saved;
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
      // The running log remains as a diagnostic record when finalization fails.
    }
  }

  private async writeRunLog(
    project: VideoProject,
    run: RunState,
    status: AiRunLog["status"],
    failureCode: string | null
  ): Promise<void> {
    const completedAt = this.now().toISOString();
    const runLog: AiRunLog = {
      runId: run.runId,
      kind: "ai",
      taskKind: "outline_generation",
      projectId: project.metadata.id,
      startRevision: run.startRevision,
      sourceHash: run.sourceHash,
      inputHash: run.inputHash,
      startedAt: run.startedAt,
      completedAt: status === "running" ? null : completedAt,
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
