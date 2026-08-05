import { randomUUID } from "node:crypto";

import {
  outlineApproveRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  projectBriefSaveRequestSchema,
  projectCreateRequestSchema,
  projectSourceSaveRequestSchema,
  projectSummarySchema,
  type ProjectSummary
} from "../../schema/api.js";
import { idSchema, type VideoProject } from "../../schema/index.js";
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
    const { project } = applyEditedOutline(currentProject, request.outline);
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
}

export { ProjectService as ProjectApplicationService };
