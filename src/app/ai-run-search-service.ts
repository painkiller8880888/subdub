import {
  idSchema,
  type AiGenerationCandidateRecord,
  type ImprovementDecisionRecord,
  type RunLog
} from "../schema/index.js";
import {
  AI_RUN_EXPORT_VERSION,
  aiRunExportRecordSchema,
  type AiRunExportQuery,
  type AiRunExportRecord,
  type AiRunSearchData,
  type AiRunSearchItem,
  type AiRunSearchQuery
} from "../schema/api.js";
import type { RunLogStoreListPort } from "./run-log-store.js";

export type AiRunSearchProjectRepositoryPort = {
  list(): Promise<
    ReadonlyArray<{
      readonly metadata: { readonly id: string };
    }>
  >;
};

export type AiRunSearchImprovementLogRepositoryPort = {
  listGenerationCandidates(
    projectId: string
  ): Promise<readonly AiGenerationCandidateRecord[]>;
  listDecisions(
    projectId: string
  ): Promise<readonly ImprovementDecisionRecord[]>;
};

export type AiRunSearchServiceOptions = {
  readonly projectRepository: AiRunSearchProjectRepositoryPort;
  readonly runLogStore: RunLogStoreListPort;
  readonly improvementLogRepository: AiRunSearchImprovementLogRepositoryPort;
};

type AiRunLog = Extract<RunLog, { kind: "ai" }>;

type RunDecisionCounts = {
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly undecidedCount: number;
  readonly modified: boolean | null;
};

function compareStrings(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}

function compareRuns(first: AiRunSearchItem, second: AiRunSearchItem): number {
  const queuedAtDifference =
    Date.parse(second.queuedAt) - Date.parse(first.queuedAt);
  if (queuedAtDifference !== 0) {
    return queuedAtDifference;
  }

  const runIdDifference = compareStrings(first.runId, second.runId);
  if (runIdDifference !== 0) {
    return runIdDifference;
  }
  return compareStrings(first.projectId, second.projectId);
}

function decisionCounts(
  run: AiRunLog,
  candidatesByRun: ReadonlyMap<string, readonly AiGenerationCandidateRecord[]>,
  decisionsByCandidateId: ReadonlyMap<string, ImprovementDecisionRecord>
): RunDecisionCounts {
  const candidates = candidatesByRun.get(run.runId) ?? [];
  let acceptedCount = 0;
  let rejectedCount = 0;
  let undecidedCount = 0;
  let judgedCount = 0;
  let modified = false;

  for (const candidate of candidates) {
    const decision = decisionsByCandidateId.get(candidate.candidateId);
    if (decision === undefined) {
      undecidedCount += 1;
      continue;
    }

    judgedCount += 1;
    if (decision.decision === "accepted") {
      acceptedCount += 1;
    } else {
      rejectedCount += 1;
    }
    if (decision.projectRevisionBefore > candidate.projectRevision) {
      modified = true;
    }
  }

  return {
    candidateCount: candidates.length,
    acceptedCount,
    rejectedCount,
    undecidedCount,
    modified: judgedCount === 0 ? null : modified
  };
}

function toSearchItem(
  run: AiRunLog,
  candidatesByRun: ReadonlyMap<string, readonly AiGenerationCandidateRecord[]>,
  decisionsByCandidateId: ReadonlyMap<string, ImprovementDecisionRecord>
): AiRunSearchItem {
  return {
    runId: run.runId,
    projectId: run.projectId,
    taskKind: run.taskKind,
    modelId: run.modelId,
    responseModel: run.responseModel,
    status: run.status,
    queuedAt: run.queuedAt,
    finishedAt: run.finishedAt,
    schemaValidation: run.schemaValidation,
    responseTimeMs: run.responseTimeMs,
    errorCode: run.errorCode,
    ...decisionCounts(run, candidatesByRun, decisionsByCandidateId)
  };
}

function toExportRecord(item: AiRunSearchItem): AiRunExportRecord {
  return aiRunExportRecordSchema.parse({
    exportVersion: AI_RUN_EXPORT_VERSION,
    runId: item.runId,
    projectId: item.projectId,
    taskKind: item.taskKind,
    modelId: item.modelId,
    responseModel: item.responseModel,
    status: item.status,
    queuedAt: item.queuedAt,
    finishedAt: item.finishedAt,
    schemaValidation: item.schemaValidation,
    responseTimeMs: item.responseTimeMs,
    errorCode: item.errorCode,
    candidateCount: item.candidateCount,
    acceptedCount: item.acceptedCount,
    rejectedCount: item.rejectedCount,
    undecidedCount: item.undecidedCount,
    modified: item.modified
  });
}

function matchesQuery(
  item: AiRunSearchItem,
  query: AiRunSearchQuery | AiRunExportQuery,
  fromMs: number | undefined,
  toMs: number | undefined
): boolean {
  const queuedAtMs = Date.parse(item.queuedAt);
  if (fromMs !== undefined && queuedAtMs < fromMs) {
    return false;
  }
  if (toMs !== undefined && queuedAtMs >= toMs) {
    return false;
  }
  if (query.taskKind !== undefined && item.taskKind !== query.taskKind) {
    return false;
  }
  if (query.modelId !== undefined && item.modelId !== query.modelId) {
    return false;
  }
  if (query.status !== undefined && item.status !== query.status) {
    return false;
  }
  if (query.errorCode !== undefined && item.errorCode !== query.errorCode) {
    return false;
  }
  if (query.decision !== undefined) {
    const decisionCount =
      query.decision === "accepted"
        ? item.acceptedCount
        : query.decision === "rejected"
          ? item.rejectedCount
          : item.undecidedCount;
    if (decisionCount === 0) {
      return false;
    }
  }
  return true;
}

function summarize(
  items: readonly AiRunSearchItem[]
): AiRunSearchData["summary"] {
  let validationPassedCount = 0;
  let validationEvaluatedCount = 0;
  let responseTimeMeasuredCount = 0;
  let responseTimeTotal = 0;
  let modifiedRunCount = 0;
  let modificationEvaluatedCount = 0;

  for (const item of items) {
    if (item.schemaValidation === "passed") {
      validationPassedCount += 1;
      validationEvaluatedCount += 1;
    } else if (item.schemaValidation === "failed") {
      validationEvaluatedCount += 1;
    }

    if (item.responseTimeMs !== null) {
      responseTimeMeasuredCount += 1;
      responseTimeTotal += item.responseTimeMs;
    }

    if (item.modified !== null) {
      modificationEvaluatedCount += 1;
      if (item.modified) {
        modifiedRunCount += 1;
      }
    }
  }

  return {
    totalCount: items.length,
    validationPassedCount,
    validationEvaluatedCount,
    validationPassRate:
      validationEvaluatedCount === 0
        ? null
        : validationPassedCount / validationEvaluatedCount,
    responseTimeMeasuredCount,
    averageResponseTimeMs:
      responseTimeMeasuredCount === 0
        ? null
        : responseTimeTotal / responseTimeMeasuredCount,
    modifiedRunCount,
    modificationEvaluatedCount
  };
}

export class AiRunSearchService {
  private readonly projectRepository: AiRunSearchProjectRepositoryPort;
  private readonly runLogStore: RunLogStoreListPort;
  private readonly improvementLogRepository: AiRunSearchImprovementLogRepositoryPort;

  constructor(options: AiRunSearchServiceOptions) {
    this.projectRepository = options.projectRepository;
    this.runLogStore = options.runLogStore;
    this.improvementLogRepository = options.improvementLogRepository;
  }

  private async collectRows(
    query: AiRunSearchQuery | AiRunExportQuery
  ): Promise<AiRunSearchItem[]> {
    const fromMs =
      query.from === undefined ? undefined : Date.parse(query.from);
    const toMs = query.to === undefined ? undefined : Date.parse(query.to);
    const projects = await this.projectRepository.list();
    const rows: AiRunSearchItem[] = [];

    for (const project of projects) {
      const projectId = idSchema.parse(project.metadata.id);
      const [runs, candidates, decisions] = await Promise.all([
        this.runLogStore.list(projectId),
        this.improvementLogRepository.listGenerationCandidates(projectId),
        this.improvementLogRepository.listDecisions(projectId)
      ]);
      const candidatesByRun = new Map<string, AiGenerationCandidateRecord[]>();
      for (const candidate of candidates) {
        if (candidate.projectId !== projectId) {
          continue;
        }
        const existing = candidatesByRun.get(candidate.generationRunId);
        if (existing === undefined) {
          candidatesByRun.set(candidate.generationRunId, [candidate]);
        } else {
          existing.push(candidate);
        }
      }

      const decisionsByCandidateId = new Map<
        string,
        ImprovementDecisionRecord
      >();
      for (const decision of decisions) {
        if (decision.projectId === projectId) {
          decisionsByCandidateId.set(decision.candidateId, decision);
        }
      }

      for (const run of runs) {
        if (run.kind !== "ai" || run.projectId !== projectId) {
          continue;
        }
        const item = toSearchItem(run, candidatesByRun, decisionsByCandidateId);
        if (matchesQuery(item, query, fromMs, toMs)) {
          rows.push(item);
        }
      }
    }

    rows.sort(compareRuns);
    return rows;
  }

  async search(input: AiRunSearchQuery): Promise<AiRunSearchData> {
    const rows = await this.collectRows(input);
    const summary = summarize(rows);
    const items = rows.slice(input.offset, input.offset + input.limit);

    return {
      items,
      summary,
      limit: input.limit,
      offset: input.offset,
      hasNextPage: input.offset + input.limit < rows.length
    };
  }

  async exportJsonLines(input: AiRunExportQuery): Promise<string> {
    const rows = await this.collectRows(input);
    if (rows.length === 0) {
      return "";
    }

    return `${rows.map((item) => JSON.stringify(toExportRecord(item))).join("\n")}\n`;
  }
}
