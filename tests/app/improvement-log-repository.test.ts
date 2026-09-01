import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ImprovementLogError } from "../../src/app/projects/improvement-log-errors.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { legacyVideoProjectFixture } from "../fixtures/video-project.js";

const NOW = "2026-08-11T00:00:00.000Z";
const SOURCE_HASH = "a".repeat(64);
const ASSET_CHECKSUM = "b".repeat(64);

function visualCandidate(assetId = "asset-photo") {
  return {
    asset: {
      assetId,
      version: 1,
      kind: "photo" as const,
      title: "Fixture photo",
      description: "",
      confidentiality: "internal",
      department: null,
      system: null,
      mimeType: "image/png",
      checksum: ASSET_CHECKSUM,
      sizeBytes: 10,
      width: 100,
      height: 100,
      durationMs: null,
      pageCount: null,
      thumbnailPaths: ["media/asset-photo/thumbnail.png"],
      tags: [],
      tagIds: [],
      status: "active" as const,
      errorCode: null,
      errorMessage: null,
      createdAt: NOW,
      updatedAt: NOW
    },
    matchedRequiredTags: [],
    matchedOptionalTags: [],
    matchReasons: ["fixture match"]
  };
}

describe("ImprovementLogRepository", () => {
  const roots: string[] = [];
  const databases: Array<
    Awaited<ReturnType<typeof initializeWorkspaceDatabase>>
  > = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close();
    }
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function createRepository(): Promise<ImprovementLogRepository> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-improvement-log-")
    );
    roots.push(workspaceRoot);
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    databases.push(database);
    return new ImprovementLogRepository(database.database);
  }

  it("stores validated AI candidates, decisions, and stable checksums", async () => {
    const repository = await createRepository();
    const candidate = await repository.insertGenerationCandidate({
      candidateId: "run-outline-candidate-outline",
      generationRunId: "run-outline",
      projectId: "project-log",
      projectRevision: 3,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: legacyVideoProjectFixture.outline,
      modelId: "model-outline",
      responseModel: "provider/model-outline",
      promptVersion: "1.0.0",
      createdAt: NOW
    });
    expect(candidate.candidateChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.candidateJson).toEqual(legacyVideoProjectFixture.outline);

    await expect(
      repository.insertGenerationCandidate({
        candidateId: "run-outline-candidate-outline-2",
        generationRunId: "run-outline",
        projectId: "project-log",
        projectRevision: 3,
        taskKind: "outline_generation",
        targetKind: "outline",
        targetId: "outline",
        candidateKey: "outline",
        candidate: legacyVideoProjectFixture.outline,
        modelId: "model-outline",
        responseModel: null,
        promptVersion: "1.0.0",
        createdAt: NOW
      })
    ).rejects.toMatchObject({
      code: "IMPROVEMENT_CANDIDATE_DUPLICATE"
    });

    const decision = await repository.insertDecision({
      decisionId: "run-outline-decision-rejected",
      candidateId: candidate.candidateId,
      projectId: "project-log",
      projectRevisionBefore: 3,
      projectRevisionAfter: 4,
      decision: "rejected",
      after: null,
      reason: "   ",
      createdAt: NOW
    });
    expect(decision.reason).toBeNull();
    expect(decision.beforeJson).toEqual(legacyVideoProjectFixture.outline);
    expect(decision.afterJson).toBeNull();

    const resend = await repository.insertDecision({
      decisionId: "run-outline-decision-rejected-resend",
      candidateId: candidate.candidateId,
      projectId: "project-log",
      projectRevisionBefore: 3,
      projectRevisionAfter: 4,
      decision: "rejected",
      after: null,
      reason: "別の理由",
      createdAt: NOW
    });
    expect(resend.decisionId).toBe(decision.decisionId);
    expect(await repository.listDecisions("project-log")).toHaveLength(1);

    await expect(
      repository.insertDecision({
        decisionId: "run-outline-decision-accepted",
        candidateId: candidate.candidateId,
        projectId: "project-log",
        projectRevisionBefore: 3,
        projectRevisionAfter: 4,
        decision: "accepted",
        after: legacyVideoProjectFixture.outline,
        reason: null,
        createdAt: NOW
      })
    ).rejects.toMatchObject({ code: "IMPROVEMENT_DECISION_CONFLICT" });
  });

  it("keeps accepted before/after payloads and deduplicates golden examples", async () => {
    const repository = await createRepository();
    const candidate = await repository.insertGenerationCandidate({
      candidateId: "run-visual-candidate-asset-photo",
      generationRunId: "run-visual",
      projectId: "project-log",
      projectRevision: 5,
      taskKind: "visual_search_intent",
      targetKind: "visual_line_range",
      targetId: "main-mentor-1:main-learner-1",
      candidateKey: "asset:asset-photo",
      candidate: visualCandidate(),
      modelId: "model-visual",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });
    const assignment = legacyVideoProjectFixture.visuals.assignments[0];
    expect(assignment).toBeDefined();
    const accepted = await repository.insertDecision({
      decisionId: "run-visual-decision-accepted",
      candidateId: candidate.candidateId,
      projectId: "project-log",
      projectRevisionBefore: 5,
      projectRevisionAfter: 6,
      decision: "accepted",
      after: assignment,
      reason: null,
      createdAt: NOW
    });
    expect(accepted.afterJson).toEqual(assignment);
    expect(accepted.reason).toBeNull();

    const firstGolden = await repository.insertGoldenExample({
      exampleId: "project-log-golden-outline-1",
      exampleKind: "approved_outline",
      projectId: "project-log",
      projectRevision: 6,
      targetId: "outline",
      sourceHash: SOURCE_HASH,
      outlineHash: null,
      payload: legacyVideoProjectFixture.outline,
      generationRunId: null,
      modelId: null,
      promptVersion: null,
      createdAt: NOW
    });
    const secondGolden = await repository.insertGoldenExample({
      exampleId: "project-log-golden-outline-2",
      exampleKind: "approved_outline",
      projectId: "project-log",
      projectRevision: 7,
      targetId: "outline",
      sourceHash: SOURCE_HASH,
      outlineHash: null,
      payload: legacyVideoProjectFixture.outline,
      generationRunId: null,
      modelId: null,
      promptVersion: null,
      createdAt: NOW
    });
    expect(secondGolden.exampleId).toBe(firstGolden.exampleId);
    expect(await repository.listGoldenExamples("project-log")).toHaveLength(1);

    const stored = JSON.stringify({
      candidate: await repository.listGenerationCandidates("project-log"),
      decisions: await repository.listDecisions("project-log"),
      golden: await repository.listGoldenExamples("project-log")
    });
    expect(stored).not.toContain("sourceMarkdown");
    expect(stored).not.toContain("OPENROUTER_API_KEY");
    expect(stored).not.toContain("C:\\");
    expect(stored).not.toContain("/absolute/");
  });

  it("rejects invalid payloads and cross-project decisions", async () => {
    const repository = await createRepository();
    await expect(
      repository.insertGenerationCandidate({
        candidateId: "run-invalid-candidate",
        generationRunId: "run-invalid",
        projectId: "project-log",
        projectRevision: 1,
        taskKind: "outline_generation",
        targetKind: "visual_line_range",
        targetId: "outline",
        candidateKey: "outline",
        candidate: {},
        modelId: "model",
        responseModel: null,
        promptVersion: "1.0.0",
        createdAt: NOW
      })
    ).rejects.toBeInstanceOf(ImprovementLogError);

    const candidate = await repository.insertGenerationCandidate({
      candidateId: "run-cross-candidate-outline",
      generationRunId: "run-cross",
      projectId: "project-log",
      projectRevision: 1,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: legacyVideoProjectFixture.outline,
      modelId: "model",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });
    await expect(
      repository.insertDecision({
        decisionId: "run-cross-decision",
        candidateId: candidate.candidateId,
        projectId: "different-project",
        projectRevisionBefore: 1,
        projectRevisionAfter: 2,
        decision: "accepted",
        after: legacyVideoProjectFixture.outline,
        reason: null,
        createdAt: NOW
      })
    ).rejects.toMatchObject({ code: "IMPROVEMENT_RELATION_INVALID" });
  });
});
