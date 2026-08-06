import { randomUUID } from "node:crypto";

import {
  outlineApproveRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  projectBriefSaveRequestSchema,
  projectCreateRequestSchema,
  projectSourceSaveRequestSchema,
  scriptApproveRequestSchema,
  scriptInitializeRequestSchema,
  scriptSaveRequestSchema,
  projectSummarySchema,
  type ProjectSummary
} from "../../schema/api.js";
import {
  idSchema,
  videoProjectSchema,
  type Outline,
  type Script,
  type VideoProject
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
  createScriptFromApprovedOutline,
  normalizeEditedScriptIds
} from "./script-domain.js";
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

  constructor(options: ProjectServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.maxCreateAttempts = Math.max(
      1,
      Math.floor(options.maxCreateAttempts ?? 5)
    );
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

  async saveOutline(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = outlineSaveRequestSchema.parse(input);
    const currentProject = await this.repository.read(projectId);
    const normalizedOutline = normalizeOutlineIds(
      currentProject.outline,
      request.outline,
      this.createId
    );
    const { project } = applyEditedOutline(currentProject, normalizedOutline);
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

    validateOutlineForApproval(snapshot.project, snapshot.sourceHash);
    return this.repository.saveOutline(
      projectId,
      { ...snapshot.project.outline, status: "approved" },
      request.expectedRevision
    );
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

    const currentOutline = snapshot.project.outline;
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
    assertCanInitializeScript(snapshot.project, snapshot.sourceHash);
    const script = createScriptFromApprovedOutline(
      snapshot.project.outline,
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
    if (currentProject.script.sections.length === 0) {
      throw new ScriptValidationError([
        {
          path: ["script", "sections"],
          message: "script must be initialized from an approved outline first"
        }
      ]);
    }

    const candidateProjectResult = videoProjectSchema.safeParse({
      ...currentProject,
      script: request.script
    });
    if (!candidateProjectResult.success) {
      throw new ScriptValidationError(
        scriptValidationIssues(candidateProjectResult.error.issues)
      );
    }

    const normalizedScript = normalizeEditedScriptIds(
      currentProject,
      candidateProjectResult.data.script,
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

  async approveScript(projectId: unknown, input: unknown): Promise<VideoProject> {
    const request = scriptApproveRequestSchema.parse(input);
    const snapshot = await this.repository.readGenerationSnapshot(projectId);
    assertCanApproveScript(snapshot.project, snapshot.sourceHash);
    const script: Script = {
      ...snapshot.project.script,
      status: "approved"
    };
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
    return this.repository.save(
      projectId,
      updatedProjectResult.data,
      request.expectedRevision
    );
  }
}

export { ProjectService as ProjectApplicationService };
