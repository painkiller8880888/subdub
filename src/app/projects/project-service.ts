import { randomUUID } from "node:crypto";

import {
  projectCharactersSaveRequestSchema,
  projectCreateRequestSchema,
  projectLineOverlaysSaveRequestSchema,
  scriptSaveRequestSchema,
  projectSummarySchema,
  type ProjectSummary
} from "../../schema/api.js";
import {
  outlineApproveRequestSchema,
  outlineRejectRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  projectBriefSaveRequestSchema,
  projectSourceSaveRequestSchema,
  scriptApproveRequestSchema,
  scriptInitializeRequestSchema
} from "../../schema/legacy-api.js";
import {
  normalizeImprovementReason,
  type AiGenerationCandidateRecord
} from "../../schema/improvement-log.js";
import {
  idSchema,
  videoProjectSchema,
  type Outline,
  type Script,
  type VideoProject,
  type VideoProjectV18
} from "../../schema/index.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "./project-repository.js";
import { createEmptyVideoProject } from "./empty-video-project.js";
import { validateOutlineForApproval } from "./outline-approval.js";
import {
  applyEditedOutline,
  hasMeaningfulOutline
} from "./project-invalidation.js";
import { applyEditedScript } from "./script-invalidation.js";
import {
  assertCanApproveScript,
  assertCanInitializeScript,
  computeOutlineHash,
  createScriptFromApprovedOutline,
  normalizeEditedScriptIds
} from "./script-domain.js";
import type { ImprovementLogRepositoryPort } from "./improvement-log-repository.js";
import {
  IMPROVEMENT_LOG_ERROR_CODE,
  ImprovementLogError
} from "./improvement-log-errors.js";
import {
  ScriptApprovalError,
  ScriptValidationError
} from "./script-errors.js";

function scriptValidationIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): Array<{ path: Array<string | number>; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number"
    ),
    message: issue.message
  }));
}

export type ProjectServiceOptions = {
  repository: ProjectRepository;
  now?: () => Date;
  createId?: () => string;
  maxCreateAttempts?: number;
  improvementLogRepository?: ImprovementLogRepositoryPort;
};

function projectSummary(project: VideoProject): ProjectSummary {
  return projectSummarySchema.parse({
    id: project.metadata.id,
    title: project.metadata.title,
    department: project.metadata.department,
    manualVersion: project.metadata.manualVersion,
    revision: project.revision,
    createdAt: project.metadata.createdAt,
    updatedAt: project.metadata.updatedAt
  });
}

function requireLegacyProject(project: VideoProject): VideoProjectV18 {
  if (!("outline" in project)) {
    throw new ProjectRepositoryError(
      "PROJECT_CANDIDATE_VALIDATION_FAILED",
      422,
      "This legacy planning operation is not available for a 1.9.0 project."
    );
  }
  return project as unknown as VideoProjectV18;
}

function compareProjectSummaries(
  first: ProjectSummary,
  second: ProjectSummary
): number {
  const updatedAtDifference =
    Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
  if (updatedAtDifference !== 0) {
    return updatedAtDifference;
  }

  if (first.id < second.id) {
    return -1;
  }
  if (first.id > second.id) {
    return 1;
  }
  return 0;
}

function outlineIds(outline: Outline): Set<string> {
  return new Set([
    ...outline.sections.flatMap((section) => [
      section.id,
      ...section.openQuestions.map((question) => question.id)
    ]),
    ...outline.openQuestions.map((question) => question.id)
  ]);
}

function normalizeOutlineIds(
  current: Outline,
  candidate: Outline,
  createId: () => string
): Outline {
  const currentIds = outlineIds(current);
  const usedIds = new Set<string>();
  const allocateId = (prefix: string, requestedId: string): string => {
    if (currentIds.has(requestedId) && !usedIds.has(requestedId)) {
      usedIds.add(requestedId);
      return requestedId;
    }

    const seed = createId();
    let generatedId = `${prefix}-${seed}`;
    let suffix = 2;
    while (currentIds.has(generatedId) || usedIds.has(generatedId)) {
      generatedId = `${prefix}-${seed}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(generatedId);
    return idSchema.parse(generatedId);
  };

  return {
    ...candidate,
    openQuestions: candidate.openQuestions.map((question) => ({
      ...question,
      id: allocateId("outline-question", question.id)
    })),
    sections: candidate.sections.map((section) => ({
      ...section,
      id: allocateId("outline-section", section.id),
      openQuestions: section.openQuestions.map((question) => ({
        ...question,
        id: allocateId("outline-question", question.id)
      }))
    }))
  };
}

export class ProjectService {
  private readonly repository: ProjectRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxCreateAttempts: number;
  private readonly improvementLogRepository:
    | ImprovementLogRepositoryPort
    | undefined;

  constructor(options: ProjectServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.maxCreateAttempts = Math.max(
      1,
      Math.floor(options.maxCreateAttempts ?? 5)
    );
    this.improvementLogRepository = options.improvementLogRepository;
  }

  async list(): Promise<ProjectSummary[]> {
    const projects = await this.repository.list();
    return projects.map(projectSummary).sort(compareProjectSummaries);
  }

  async create(input: unknown): Promise<VideoProject> {
    const createInput = projectCreateRequestSchema.parse(input);
    const createdAt = this.now().toISOString();
    let lastCollision: ProjectRepositoryError | undefined;

    for (let attempt = 0; attempt < this.maxCreateAttempts; attempt += 1) {
      const projectId = idSchema.parse(this.createId());
      const project = createEmptyVideoProject({
        projectId,
        title: createInput.title,
        department: createInput.department ?? "General",
        manualVersion: createInput.manualVersion ?? "",
        createdAt
      });

      try {
        return await this.repository.create(project);
      } catch (error) {
        if (
          error instanceof ProjectRepositoryError &&
          error.code === "PROJECT_ALREADY_EXISTS"
        ) {
          lastCollision = error;
          continue;
        }
        throw error;
      }
    }

    if (lastCollision !== undefined) {
      throw lastCollision;
    }

    throw new Error("Project creation did not produce an ID.");
  }

  async read(projectId: unknown): Promise<VideoProject> {
    return this.repository.read(projectId);
  }

  async readSource(projectId: unknown) {
    return this.repository.readSource(projectId);
  }

  async saveSource(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = projectSourceSaveRequestSchema.parse(input);
    return this.repository.saveSource(
      projectId,
      request.markdown,
      request.expectedRevision
    );
  }

  async saveBrief(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = projectBriefSaveRequestSchema.parse(input);
    return this.repository.saveBrief(
      projectId,
      request.brief,
      request.expectedRevision
    );
  }

  async saveCharacterVisualBindings(
    projectId: unknown,
    input: unknown
  ): Promise<VideoProject> {
    const request = projectCharactersSaveRequestSchema.parse(input);
    const currentProject = await this.repository.read(projectId);
    const submittedById = new Map(
      request.characters.map((character) => [character.characterId, character])
    );
    const issues = [];
    for (const [index, character] of currentProject.characters.entries()) {
      if (!submittedById.has(character.id)) {
        issues.push({
          path: ["characters", index, "characterId"],
          message: "characterId must reference a project character"
        });
      }
    }
    for (const [index, character] of request.characters.entries()) {
      if (!currentProject.characters.some((candidate) => candidate.id === character.characterId)) {
        issues.push({
          path: ["characters", index, "characterId"],
          message: "characterId must reference a project character"
        });
      }
    }
    if (issues.length > 0) {
      throw new ProjectRepositoryError(
        "PROJECT_CANDIDATE_VALIDATION_FAILED",
        422,
        "The character visual binding candidate is invalid.",
        issues
      );
    }

    const candidate: VideoProject = {
      ...currentProject,
      characters: currentProject.characters.map((character) => ({
        ...character,
        characterVisual: submittedById.get(character.id)!.characterVisual
      }))
    };
    return this.repository.save(
      projectId,
      candidate,
      request.expectedRevision
    );
  }

  async saveOutline(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineSaveRequestSchema.parse(input);
    const currentProject = await this.repository.read(projectId);
    const legacyProject = requireLegacyProject(currentProject);
    const normalizedOutline = normalizeOutlineIds(
      legacyProject.outline,
      request.outline,
      this.createId
    );
    const { project } = applyEditedOutline(
      legacyProject as unknown as VideoProject,
      normalizedOutline
    );
    return this.repository.save(projectId, project, request.expectedRevision);
  }

  async approveOutline(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineApproveRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    if (snapshot.project.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }

    const legacyProject = requireLegacyProject(snapshot.project);
    validateOutlineForApproval(legacyProject, snapshot.sourceHash);
    const candidate = await this.findOutlineCandidate(
      snapshot.project.metadata.id,
      legacyProject.outline
    );
    const saved = await this.repository.saveOutline(
      projectId,
      { ...legacyProject.outline, status: "approved" },
      request.expectedRevision
    );
    if (this.improvementLogRepository !== undefined) {
      if (candidate !== undefined) {
        await this.improvementLogRepository.insertDecision({
          decisionId: `${candidate.candidateId}-decision-accepted`,
          candidateId: candidate.candidateId,
          projectId: saved.metadata.id,
          projectRevisionBefore: request.expectedRevision,
          projectRevisionAfter: saved.revision,
          decision: "accepted",
          after: (saved as unknown as VideoProjectV18).outline,
          reason: normalizeImprovementReason(request.reason),
          createdAt: this.now().toISOString()
        });
      }
      await this.improvementLogRepository.insertGoldenExample({
        exampleId: `${saved.metadata.id}-golden-outline-${saved.revision}`,
        exampleKind: "approved_outline",
        projectId: saved.metadata.id,
        projectRevision: saved.revision,
        targetId: "outline",
        sourceHash: snapshot.sourceHash,
        outlineHash: null,
        payload: (saved as unknown as VideoProjectV18).outline,
        generationRunId: candidate?.generationRunId ?? null,
        modelId: candidate?.modelId ?? null,
        promptVersion: candidate?.promptVersion ?? null,
        createdAt: this.now().toISOString()
      });
    }
    return saved;
  }

  async rejectOutline(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineRejectRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    if (snapshot.project.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }
    const legacyProject = requireLegacyProject(snapshot.project);
    if (legacyProject.outline.status === "approved") {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.rejectionNotAllowed,
        409,
        "An approved outline cannot be rejected."
      );
    }
    if (
      legacyProject.outline.generationRunId === null ||
      snapshot.project.script.sections.length > 0 ||
      snapshot.project.visuals.assignments.length > 0 ||
      snapshot.project.visuals.suggestionRunIds.length > 0 ||
      snapshot.project.visuals.status !== "draft"
    ) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.rejectionNotAllowed,
        409,
        "The generated outline cannot be rejected after downstream work exists."
      );
    }
    const candidate = await this.findOutlineCandidate(
      snapshot.project.metadata.id,
      legacyProject.outline
    );
    if (candidate === undefined || this.improvementLogRepository === undefined) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.candidateNotFound,
        404,
        "The AI outline candidate does not exist."
      );
    }
    const existingDecision =
      await this.improvementLogRepository.findDecisionForCandidate({
        candidateId: candidate.candidateId
      });
    if (existingDecision !== undefined) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.decisionConflict,
        409,
        "The AI outline candidate already has a final decision."
      );
    }
    const draftOutline: Outline = {
      status: "draft",
      sourceHash: snapshot.sourceHash,
      generationRunId: null,
      openQuestions: [],
      sections: []
    };
    const saved = await this.repository.saveOutline(
      projectId,
      draftOutline,
      request.expectedRevision
    );
    await this.improvementLogRepository.insertDecision({
      decisionId: `${candidate.candidateId}-decision-rejected`,
      candidateId: candidate.candidateId,
      projectId: saved.metadata.id,
      projectRevisionBefore: request.expectedRevision,
      projectRevisionAfter: saved.revision,
      decision: "rejected",
      after: null,
      reason: normalizeImprovementReason(request.reason),
      createdAt: this.now().toISOString()
    });
    return saved;
  }

  async reviewOutline(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineReviewRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    if (snapshot.project.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }

    const legacyProject = requireLegacyProject(snapshot.project);
    const currentOutline = legacyProject.outline;
    const reviewedOutline = {
      ...currentOutline,
      sourceHash: snapshot.sourceHash,
      status: hasMeaningfulOutline(currentOutline) ? "needs_review" : "draft"
    } as const;
    return this.repository.saveOutline(
      projectId,
      reviewedOutline,
      request.expectedRevision
    );
  }

  async initializeScript(
    projectId: unknown,
    input: unknown
  ): Promise<VideoProject> {
    const request = scriptInitializeRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    const legacyProject = requireLegacyProject(snapshot.project);
    assertCanInitializeScript(snapshot.project, snapshot.sourceHash);
    const script = createScriptFromApprovedOutline(
      legacyProject.outline,
      this.createId
    );
    return this.repository.saveScript(
      projectId,
      script,
      request.expectedRevision
    );
  }

  async saveScript(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = scriptSaveRequestSchema.parse(input);
    const currentProject = await this.repository.read(projectId);
    if (currentProject.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }
    if (currentProject.script.sections.length === 0) {
      throw new ScriptValidationError([
        {
          path: ["script", "sections"],
          message: "script must be initialized from an approved outline first"
        }
      ]);
    }

    const normalizedScript = normalizeEditedScriptIds(
      currentProject,
      request.script,
      this.createId
    );
    const { project } = applyEditedScript(currentProject, normalizedScript);
    const updatedProjectResult = videoProjectSchema.safeParse(project);
    if (!updatedProjectResult.success) {
      throw new ScriptValidationError(
        scriptValidationIssues(updatedProjectResult.error.issues)
      );
    }

    return this.repository.save(
      projectId,
      updatedProjectResult.data,
      request.expectedRevision
    );
  }

  async saveLineOverlays(
    projectId: unknown,
    input: unknown
  ): Promise<VideoProject> {
    const request = projectLineOverlaysSaveRequestSchema.parse(input);
    const currentProject = await this.repository.read(projectId);
    return this.repository.save(
      projectId,
      {
        ...currentProject,
        overlays: request.overlays
      },
      request.expectedRevision
    );
  }

  async approveScript(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = scriptApproveRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    if (snapshot.project.revision !== request.expectedRevision) {
      throw new ProjectRepositoryError(
        "PROJECT_REVISION_CONFLICT",
        409,
        "The project revision does not match the expected revision."
      );
    }

    assertCanApproveScript(snapshot.project, snapshot.sourceHash);
    const script: Script = snapshot.project.script;
    const updatedProject = {
      ...snapshot.project,
      script
    };
    const updatedProjectResult = videoProjectSchema.safeParse(updatedProject);
    if (!updatedProjectResult.success) {
      throw new ScriptApprovalError(
        scriptValidationIssues(updatedProjectResult.error.issues)
      );
    }
    const candidate = await this.findOutlineCandidate(
      snapshot.project.metadata.id,
      requireLegacyProject(snapshot.project).outline
    );
    const saved = await this.repository.save(
      projectId,
      updatedProjectResult.data,
      request.expectedRevision
    );
    if (this.improvementLogRepository !== undefined) {
      await this.improvementLogRepository.insertGoldenExample({
        exampleId: `${saved.metadata.id}-golden-script-${saved.revision}`,
        exampleKind: "approved_script_bundle",
        projectId: saved.metadata.id,
        projectRevision: saved.revision,
        targetId: "script",
        sourceHash: snapshot.sourceHash,
        outlineHash: computeOutlineHash(
          (saved as unknown as VideoProjectV18).outline
        ),
        payload: {
          outline: (saved as unknown as VideoProjectV18).outline,
          script: saved.script,
          characters: saved.characters
        },
        generationRunId: candidate?.generationRunId ?? null,
        modelId: candidate?.modelId ?? null,
        promptVersion: candidate?.promptVersion ?? null,
        createdAt: this.now().toISOString()
      });
    }
    return saved;
  }

  private async findOutlineCandidate(
    projectId: string,
    outline: Outline
  ): Promise<AiGenerationCandidateRecord | undefined> {
    if (
      this.improvementLogRepository === undefined ||
      outline.generationRunId === null
    ) {
      return undefined;
    }
    const candidate =
      await this.improvementLogRepository.findGenerationCandidate({
        projectId,
        generationRunId: outline.generationRunId,
        candidateKey: "outline"
      });
    if (candidate === undefined) {
      // Migration 0005 intentionally does not reconstruct candidates from
      // existing project JSON. Keep pre-migration outlines approvable as
      // legacy data, without inventing AI metadata or a candidate row.
      return undefined;
    }
    if (
      candidate.taskKind !== "outline_generation" ||
      candidate.targetKind !== "outline" ||
      candidate.targetId !== "outline"
    ) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
        422,
        "The AI outline candidate relation is invalid."
      );
    }
    return candidate;
  }
}

export { ProjectService as ProjectApplicationService };
