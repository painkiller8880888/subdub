import { randomUUID } from "node:crypto";

import {
  projectCreateRequestSchema,
  projectSummarySchema,
  type ProjectSummary
} from "../../schema/api.js";
import { idSchema, type VideoProject } from "../../schema/index.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "./project-repository.js";
import { createEmptyVideoProject } from "./empty-video-project.js";

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
}

export { ProjectService as ProjectApplicationService };
