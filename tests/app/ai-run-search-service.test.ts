import { describe, expect, it, vi } from "vitest";

import { AiRunSearchService } from "../../src/app/ai-run-search-service.js";
import {
  aiRunExportQuerySchema,
  aiRunExportRecordSchema,
  aiRunSearchQuerySchema,
  type AiRunSearchQuery
} from "../../src/schema/api.js";
import {
  aiGenerationCandidateRecordSchema,
  improvementDecisionRecordSchema,
  runLogSchema,
  type AiGenerationCandidateRecord,
  type ImprovementDecisionRecord,
  type RunLog
} from "../../src/schema/index.js";

const hash = "a".repeat(64);
const privacy = {
  execution: "external" as const,
  dataCollection: "deny" as const,
  zdr: true,
  providerFallbacks: true
};

type AiRunLog = Extract<RunLog, { kind: "ai" }>;

function makeRun(options: {
  readonly runId: string;
  readonly projectId: string;
  readonly queuedAt: string;
  readonly taskKind?: AiRunLog["taskKind"];
  readonly modelId?: string | null;
  readonly responseModel?: string | null;
  readonly status?: "succeeded" | "failed";
  readonly schemaValidation?: AiRunLog["schemaValidation"];
  readonly responseTimeMs?: number | null;
  readonly errorCode?: string | null;
}): AiRunLog {
  const status = options.status ?? "succeeded";
  return runLogSchema.parse({
    runId: options.runId,
    projectId: options.projectId,
    projectRevision: 1,
    queuedAt: options.queuedAt,
    startedAt: options.queuedAt,
    finishedAt: options.queuedAt,
    status,
    inputHash: hash,
    model: options.modelId ?? null,
    engine: null,
    privacy,
    outputs: status === "succeeded" ? [{ checksum: hash }] : [],
    errorCode: status === "failed" ? (options.errorCode ?? "AI_FAILED") : null,
    kind: "ai",
    taskKind: options.taskKind ?? "visual_search_intent",
    sourceHash: hash,
    modelId: options.modelId ?? null,
    modelSelectionSource: "default",
    responseModel: options.responseModel ?? null,
    provider: options.responseModel === null ? null : "fixture",
    zdr: true,
    dataCollection: "deny",
    providerFallbacks: true,
    responseTimeMs: options.responseTimeMs ?? null,
    httpAttemptCount: 1,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    costCredits: null,
    schemaValidation:
      options.schemaValidation ??
      (status === "succeeded" ? "passed" : "failed"),
    imageInput: false,
    tools: false
  }) as AiRunLog;
}

function makeVoiceRun(
  projectId: string,
  runId: string,
  queuedAt: string
): RunLog {
  return runLogSchema.parse({
    runId,
    projectId,
    projectRevision: 1,
    queuedAt,
    startedAt: queuedAt,
    finishedAt: queuedAt,
    status: "succeeded",
    inputHash: hash,
    model: null,
    engine: "VOICEVOX",
    privacy: {
      execution: "local",
      dataCollection: null,
      zdr: null,
      providerFallbacks: null
    },
    outputs: [{ checksum: hash }],
    errorCode: null,
    kind: "voice",
    engineVersion: "fixture-1",
    targetCount: 0,
    generatedCount: 0,
    noOp: true,
    lineFailures: []
  });
}

function makeCandidate(options: {
  readonly candidateId: string;
  readonly generationRunId: string;
  readonly projectId: string;
  readonly projectRevision: number;
}): AiGenerationCandidateRecord {
  return aiGenerationCandidateRecordSchema.parse({
    candidateId: options.candidateId,
    generationRunId: options.generationRunId,
    projectId: options.projectId,
    projectRevision: options.projectRevision,
    taskKind: "visual_search_intent",
    targetKind: "visual_line_range",
    targetId: "main-mentor-1:main-learner-1",
    candidateKey: options.candidateId,
    candidateJson: {
      candidateId: options.candidateId,
      sourceMarkdown: "SOURCE_MARKDOWN_SECRET",
      apiKey: "API_KEY_SECRET",
      windowsPath: "C:\\private\\source.md",
      posixPath: "/private/source.md"
    },
    candidateChecksum: hash,
    modelId: "google/gemma-4-31b-it",
    responseModel: "provider/gemma",
    promptVersion: "fixture-v1",
    createdAt: "2026-08-11T00:00:00.000Z"
  });
}

function makeDecision(options: {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly projectId: string;
  readonly projectRevisionBefore: number;
  readonly decision: "accepted" | "rejected";
}): ImprovementDecisionRecord {
  return improvementDecisionRecordSchema.parse({
    decisionId: options.decisionId,
    candidateId: options.candidateId,
    projectId: options.projectId,
    projectRevisionBefore: options.projectRevisionBefore,
    projectRevisionAfter: options.projectRevisionBefore + 1,
    taskKind: "visual_search_intent",
    targetKind: "visual_line_range",
    targetId: "main-mentor-1:main-learner-1",
    decision: options.decision,
    beforeJson: {
      fixture: "before",
      goldenPayload: "GOLDEN_PAYLOAD_SECRET"
    },
    afterJson: {
      fixture: "after",
      sourceMarkdown: "SOURCE_MARKDOWN_SECRET"
    },
    reason: "DECISION_REASON_SECRET",
    modelId: "google/gemma-4-31b-it",
    promptVersion: "fixture-v1",
    createdAt: "2026-08-11T00:00:01.000Z"
  });
}

function makeQuery(
  overrides: Partial<AiRunSearchQuery> = {}
): AiRunSearchQuery {
  return aiRunSearchQuerySchema.parse(overrides);
}

function createFixture() {
  const runsByProject = new Map<string, RunLog[]>([
    [
      "project-one",
      [
        makeRun({
          runId: "run-mixed",
          projectId: "project-one",
          queuedAt: "2026-08-11T05:00:00.000Z",
          modelId: "google/gemma-4-31b-it",
          responseModel: "provider/gemma",
          responseTimeMs: 100
        }),
        makeRun({
          runId: "run-undecided",
          projectId: "project-one",
          queuedAt: "2026-08-11T03:00:00.000Z",
          status: "failed",
          modelId: null,
          responseModel: null,
          schemaValidation: "not_run",
          responseTimeMs: null,
          errorCode: "OPENROUTER_TIMEOUT"
        }),
        makeRun({
          runId: "run-empty",
          projectId: "project-one",
          queuedAt: "2026-08-11T01:00:00.000Z",
          taskKind: "opencode",
          modelId: "google/gemma-4-31b-it",
          responseModel: "provider/gemma",
          responseTimeMs: 50
        })
      ]
    ],
    [
      "project-two",
      [
        makeRun({
          runId: "run-false",
          projectId: "project-two",
          queuedAt: "2026-08-11T05:00:00.000Z",
          taskKind: "layout_review",
          modelId: "other/model",
          responseModel: "provider/other",
          schemaValidation: "failed",
          responseTimeMs: 200
        }),
        makeVoiceRun("project-two", "voice-not-ai", "2026-08-11T06:00:00.000Z")
      ]
    ]
  ]);

  const candidatesByProject = new Map<string, AiGenerationCandidateRecord[]>([
    [
      "project-one",
      [
        makeCandidate({
          candidateId: "candidate-accepted",
          generationRunId: "run-mixed",
          projectId: "project-one",
          projectRevision: 1
        }),
        makeCandidate({
          candidateId: "candidate-rejected",
          generationRunId: "run-mixed",
          projectId: "project-one",
          projectRevision: 1
        }),
        makeCandidate({
          candidateId: "candidate-undecided",
          generationRunId: "run-undecided",
          projectId: "project-one",
          projectRevision: 2
        })
      ]
    ],
    ["project-two", []]
  ]);
  candidatesByProject.get("project-two")!.push(
    makeCandidate({
      candidateId: "candidate-false",
      generationRunId: "run-false",
      projectId: "project-two",
      projectRevision: 5
    })
  );

  const decisionsByProject = new Map<string, ImprovementDecisionRecord[]>([
    [
      "project-one",
      [
        makeDecision({
          decisionId: "decision-accepted",
          candidateId: "candidate-accepted",
          projectId: "project-one",
          projectRevisionBefore: 2,
          decision: "accepted"
        }),
        makeDecision({
          decisionId: "decision-rejected",
          candidateId: "candidate-rejected",
          projectId: "project-one",
          projectRevisionBefore: 1,
          decision: "rejected"
        })
      ]
    ],
    [
      "project-two",
      [
        makeDecision({
          decisionId: "decision-false",
          candidateId: "candidate-false",
          projectId: "project-two",
          projectRevisionBefore: 5,
          decision: "accepted"
        })
      ]
    ]
  ]);

  const projectRepository = {
    list: vi.fn(async () => [
      { metadata: { id: "project-one" } },
      { metadata: { id: "project-two" } }
    ])
  };
  const runLogStore = {
    list: vi.fn(async (projectId: string) => runsByProject.get(projectId) ?? [])
  };
  const improvementLogRepository = {
    listGenerationCandidates: vi.fn(
      async (projectId: string) => candidatesByProject.get(projectId) ?? []
    ),
    listDecisions: vi.fn(
      async (projectId: string) => decisionsByProject.get(projectId) ?? []
    )
  };

  return {
    service: new AiRunSearchService({
      projectRepository,
      runLogStore,
      improvementLogRepository
    }),
    projectRepository,
    runLogStore,
    improvementLogRepository,
    runsByProject
  };
}

describe("AiRunSearchService", () => {
  it("joins projects, excludes non-AI runs, summarizes before pagination, and sorts ties", async () => {
    const fixture = createFixture();

    const result = await fixture.service.search(makeQuery({ limit: 1 }));

    expect(result.items.map((item) => item.runId)).toEqual(["run-false"]);
    expect(result.hasNextPage).toBe(true);
    expect(result.summary).toEqual({
      totalCount: 4,
      validationPassedCount: 2,
      validationEvaluatedCount: 3,
      validationPassRate: 2 / 3,
      responseTimeMeasuredCount: 3,
      averageResponseTimeMs: 350 / 3,
      modifiedRunCount: 1,
      modificationEvaluatedCount: 2
    });
    expect(fixture.projectRepository.list).toHaveBeenCalledTimes(1);
    expect(fixture.runLogStore.list).toHaveBeenCalledTimes(2);
    expect(
      fixture.improvementLogRepository.listGenerationCandidates
    ).toHaveBeenCalledTimes(2);
    expect(
      fixture.improvementLogRepository.listDecisions
    ).toHaveBeenCalledTimes(2);

    const all = await fixture.service.search(makeQuery());
    expect(all.items.map((item) => item.runId)).toEqual([
      "run-false",
      "run-mixed",
      "run-undecided",
      "run-empty"
    ]);
    expect(all.items[1]).toMatchObject({
      candidateCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      undecidedCount: 0,
      modified: true
    });
    expect(all.items[2]).toMatchObject({
      candidateCount: 1,
      acceptedCount: 0,
      rejectedCount: 0,
      undecidedCount: 1,
      modified: null
    });
    expect(all.items[3]).toMatchObject({
      candidateCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      undecidedCount: 0,
      modified: null
    });
    expect(all.items[0]).toMatchObject({ modified: false });
  });

  it("applies independent and combined filters with inclusive/exclusive dates", async () => {
    const fixture = createFixture();
    const search = async (query: Partial<AiRunSearchQuery>) =>
      (await fixture.service.search(makeQuery(query))).items.map(
        (item) => item.runId
      );

    await expect(
      search({
        from: "2026-08-11T03:00:00.000Z",
        to: "2026-08-11T05:00:00.000Z"
      })
    ).resolves.toEqual(["run-undecided"]);
    await expect(search({ taskKind: "opencode" })).resolves.toEqual([
      "run-empty"
    ]);
    await expect(search({ modelId: "google/gemma-4-31b-it" })).resolves.toEqual(
      ["run-mixed", "run-empty"]
    );
    await expect(search({ status: "failed" })).resolves.toEqual([
      "run-undecided"
    ]);
    await expect(search({ errorCode: "OPENROUTER_TIMEOUT" })).resolves.toEqual([
      "run-undecided"
    ]);
    await expect(search({ decision: "accepted" })).resolves.toEqual([
      "run-false",
      "run-mixed"
    ]);
    await expect(search({ decision: "rejected" })).resolves.toEqual([
      "run-mixed"
    ]);
    await expect(search({ decision: "undecided" })).resolves.toEqual([
      "run-undecided"
    ]);
    await expect(
      search({ taskKind: "layout_review", modelId: "other/model" })
    ).resolves.toEqual(["run-false"]);
  });

  it("exports the same filtered, sorted rows without pagination", async () => {
    const fixture = createFixture();
    const exportIds = async (query: Record<string, unknown> = {}) => {
      const body = await fixture.service.exportJsonLines(
        aiRunExportQuerySchema.parse(query)
      );
      return body
        .trimEnd()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => aiRunExportRecordSchema.parse(JSON.parse(line)).runId);
    };

    await expect(
      exportIds({
        from: "2026-08-11T03:00:00.000Z",
        to: "2026-08-11T05:00:00.000Z"
      })
    ).resolves.toEqual(["run-undecided"]);
    await expect(exportIds({ taskKind: "opencode" })).resolves.toEqual([
      "run-empty"
    ]);
    await expect(
      exportIds({ modelId: "google/gemma-4-31b-it" })
    ).resolves.toEqual(["run-mixed", "run-empty"]);
    await expect(exportIds({ status: "failed" })).resolves.toEqual([
      "run-undecided"
    ]);
    await expect(
      exportIds({ errorCode: "OPENROUTER_TIMEOUT" })
    ).resolves.toEqual(["run-undecided"]);
    await expect(exportIds({ decision: "accepted" })).resolves.toEqual([
      "run-false",
      "run-mixed"
    ]);
    await expect(
      exportIds({ taskKind: "layout_review", modelId: "other/model" })
    ).resolves.toEqual(["run-false"]);
  });

  it("exports more than one search page and excludes sensitive joined payloads", async () => {
    const fixture = createFixture();
    const runs = fixture.runsByProject.get("project-one");
    if (runs === undefined) {
      throw new Error("expected project-one fixture");
    }
    for (let index = 0; index < 101; index += 1) {
      runs.push(
        makeRun({
          runId: `run-many-${String(index).padStart(3, "0")}`,
          projectId: "project-one",
          queuedAt: "2026-08-10T00:00:00.000Z"
        })
      );
    }

    const body = await fixture.service.exportJsonLines(
      aiRunExportQuerySchema.parse({})
    );
    const lines = body.split("\n");
    expect(lines.at(-1)).toBe("");
    const records = lines
      .slice(0, -1)
      .map((line) => aiRunExportRecordSchema.parse(JSON.parse(line)));

    expect(records).toHaveLength(105);
    expect(body).not.toContain("candidateJson");
    expect(body).not.toContain("beforeJson");
    expect(body).not.toContain("afterJson");
    expect(body).not.toContain("GOLDEN_PAYLOAD_SECRET");
    expect(body).not.toContain("SOURCE_MARKDOWN_SECRET");
    expect(body).not.toContain("DECISION_REASON_SECRET");
    expect(body).not.toContain("API_KEY_SECRET");
    expect(body).not.toContain("C:\\private");
    expect(body).not.toContain("/private");
    expect(records[0]?.runId).toBe("run-false");
    expect(records.at(-1)?.runId).toBe("run-many-100");
  });

  it("returns an empty body for an empty export", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.exportJsonLines(
        aiRunExportQuerySchema.parse({ modelId: "missing/model" })
      )
    ).resolves.toBe("");
  });
});
