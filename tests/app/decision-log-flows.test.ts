import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { ProjectService } from "../../src/app/projects/project-service.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import type { Outline, VideoProject } from "../../src/schema/index.js";

const NOW = "2026-08-11T01:00:00.000Z";

function makeOutline(
  project: VideoProject,
  generationRunId: string | null,
  status: Outline["status"] = "needs_review"
): Outline {
  const section = (
    id: string,
    order: number,
    role: Outline["sections"][number]["role"]
  ): Outline["sections"][number] => ({
    id,
    order,
    role,
    title: id,
    overview: id,
    keyPoints: [id],
    targetDurationSec: 10,
    sourceRefs: [{ sourceId: project.source.id, headingPath: [] }],
    openQuestions: [],
    humanDirectives: {
      requiredItems: [],
      prohibitedItems: [],
      scriptConstraints: []
    },
    lockedFields: []
  });
  return {
    status,
    sourceHash: project.source.sha256,
    generationRunId,
    openQuestions: [],
    sections: [
      section("outline-intro", 1, "intro"),
      section("outline-main", 2, "main"),
      section("outline-outro", 3, "outro")
    ]
  };
}

describe("decision log service flows", () => {
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

  async function setup(): Promise<{
    repository: ProjectRepository;
    service: ProjectService;
    log: ImprovementLogRepository;
    project: VideoProject;
  }> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-decision-flow-")
    );
    roots.push(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, "library"), { recursive: true });
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    databases.push(database);
    const log = new ImprovementLogRepository(database.database);
    const repository = new ProjectRepository({
      workspaceRoot,
      now: () => new Date(NOW)
    });
    const service = new ProjectService({
      repository,
      now: () => new Date(NOW),
      improvementLogRepository: log
    });
    const created = await repository.create(
      createEmptyVideoProject({
        projectId: "decision-flow-project",
        createdAt: NOW,
        updatedAt: NOW
      })
    );
    const withSource = await repository.saveSource(
      created.metadata.id,
      "# source",
      created.revision
    );
    const project = await repository.saveBrief(
      created.metadata.id,
      { ...withSource.brief, audience: "利用者" },
      withSource.revision
    );
    return { repository, service, log, project };
  }

  it("records an accepted AI outline with the original and approved payloads", async () => {
    const { repository, service, log, project } = await setup();
    const outline = makeOutline(project, "run-outline");
    const withOutline = await repository.saveOutline(
      project.metadata.id,
      outline,
      project.revision
    );
    await log.insertGenerationCandidate({
      candidateId: "run-outline-candidate-outline",
      generationRunId: "run-outline",
      projectId: project.metadata.id,
      projectRevision: withOutline.revision,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: outline,
      modelId: "model-outline",
      responseModel: "provider/model",
      promptVersion: "1.0.0",
      createdAt: NOW
    });

    const approved = await service.approveOutline(project.metadata.id, {
      expectedRevision: withOutline.revision,
      reason: "   "
    });
    const decisions = await log.listDecisions(project.metadata.id);
    const examples = await log.listGoldenExamples(project.metadata.id);

    expect(approved.outline.status).toBe("approved");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: "accepted",
      reason: null,
      beforeJson: { status: "needs_review" },
      afterJson: { status: "approved" },
      modelId: "model-outline",
      promptVersion: "1.0.0"
    });
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({
      exampleKind: "approved_outline",
      generationRunId: "run-outline",
      modelId: "model-outline",
      promptVersion: "1.0.0"
    });
  });

  it("keeps the original candidate separate from an edited approved outline", async () => {
    const { repository, service, log, project } = await setup();
    const outline = makeOutline(project, "run-outline-edit");
    const withOutline = await repository.saveOutline(
      project.metadata.id,
      outline,
      project.revision
    );
    await log.insertGenerationCandidate({
      candidateId: "run-outline-edit-candidate-outline",
      generationRunId: "run-outline-edit",
      projectId: project.metadata.id,
      projectRevision: withOutline.revision,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: outline,
      modelId: "model-outline",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });

    const edited = await service.saveOutline(project.metadata.id, {
      outline: {
        ...outline,
        sections: outline.sections.map((section) =>
          section.id === "outline-main"
            ? { ...section, title: "human edited title" }
            : section
        )
      },
      expectedRevision: withOutline.revision
    });
    const approved = await service.approveOutline(project.metadata.id, {
      expectedRevision: edited.revision
    });
    const decision = (await log.listDecisions(project.metadata.id))[0];

    expect(approved.outline.sections[1]?.title).toBe("human edited title");
    expect(decision?.beforeJson).toEqual(outline);
    expect(decision?.afterJson).toEqual(approved.outline);
    expect(decision?.beforeJson).not.toEqual(decision?.afterJson);
  });

  it("rejects an AI outline by recording the candidate without a golden example", async () => {
    const { repository, service, log, project } = await setup();
    const outline = makeOutline(project, "run-reject");
    const withOutline = await repository.saveOutline(
      project.metadata.id,
      outline,
      project.revision
    );
    await log.insertGenerationCandidate({
      candidateId: "run-reject-candidate-outline",
      generationRunId: "run-reject",
      projectId: project.metadata.id,
      projectRevision: withOutline.revision,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: outline,
      modelId: "model-outline",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });

    const rejected = await service.rejectOutline(project.metadata.id, {
      expectedRevision: withOutline.revision,
      reason: "根拠が不足"
    });
    const decisions = await log.listDecisions(project.metadata.id);

    expect(rejected.outline).toMatchObject({
      status: "draft",
      generationRunId: null,
      sections: []
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: "rejected",
      reason: "根拠が不足",
      afterJson: null
    });
    expect(await log.listGoldenExamples(project.metadata.id)).toHaveLength(0);
  });

  it("stores a manual approved script bundle without invented AI metadata", async () => {
    const { repository, service, log, project } = await setup();
    const outline = await repository.saveOutline(
      project.metadata.id,
      makeOutline(project, null, "approved"),
      project.revision
    );
    const initialized = await service.initializeScript(project.metadata.id, {
      expectedRevision: outline.revision
    });
    const approved = await service.approveScript(project.metadata.id, {
      expectedRevision: initialized.revision
    });
    const examples = await log.listGoldenExamples(project.metadata.id);

    expect(approved.script.status).toBe("approved");
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({
      exampleKind: "approved_script_bundle",
      generationRunId: null,
      modelId: null,
      promptVersion: null
    });
    expect(examples[0]?.payloadJson).toEqual({
      outline: approved.outline,
      script: approved.script,
      characters: approved.characters
    });
  });

  it("keeps pre-migration AI outlines approvable as legacy examples", async () => {
    const { repository, service, log, project } = await setup();
    const withLegacyOutline = await repository.saveOutline(
      project.metadata.id,
      makeOutline(project, "legacy-outline-run"),
      project.revision
    );

    const approvedOutline = await service.approveOutline(project.metadata.id, {
      expectedRevision: withLegacyOutline.revision
    });
    const initialized = await service.initializeScript(project.metadata.id, {
      expectedRevision: approvedOutline.revision
    });
    const approvedScript = await service.approveScript(project.metadata.id, {
      expectedRevision: initialized.revision
    });
    const examples = await log.listGoldenExamples(project.metadata.id);

    expect(approvedScript.script.status).toBe("approved");
    expect(await log.listDecisions(project.metadata.id)).toHaveLength(0);
    expect(examples).toHaveLength(2);
    expect(
      examples.find((example) => example.exampleKind === "approved_outline")
    ).toMatchObject({
      generationRunId: null,
      modelId: null,
      promptVersion: null
    });
    expect(
      examples.find(
        (example) => example.exampleKind === "approved_script_bundle"
      )
    ).toMatchObject({
      generationRunId: null,
      modelId: null,
      promptVersion: null
    });
  });

  it("does not record a decision when approval loses a revision race", async () => {
    const { repository, service, log, project } = await setup();
    const outline = await repository.saveOutline(
      project.metadata.id,
      makeOutline(project, "run-conflict"),
      project.revision
    );
    await log.insertGenerationCandidate({
      candidateId: "run-conflict-candidate-outline",
      generationRunId: "run-conflict",
      projectId: project.metadata.id,
      projectRevision: outline.revision,
      taskKind: "outline_generation",
      targetKind: "outline",
      targetId: "outline",
      candidateKey: "outline",
      candidate: outline.outline,
      modelId: "model-outline",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });

    await expect(
      service.approveOutline(project.metadata.id, {
        expectedRevision: outline.revision - 1
      })
    ).rejects.toMatchObject({ code: "PROJECT_REVISION_CONFLICT" });
    expect(await log.listDecisions(project.metadata.id)).toHaveLength(0);
    expect(await log.listGoldenExamples(project.metadata.id)).toHaveLength(0);
  });
});
