import { randomUUID } from "node:crypto";

import {
  projectCharactersSaveRequestSchema,
  projectCreateRequestSchema,
  projectLineOverlaysSaveRequestSchema,
  scriptSaveRequestSchema,
  projectSummarySchema,
  type ProjectSummary
} from "../../schema/api.js";
import { idSchema } from "../../schema/primitives.js";
import {
  videoProjectSchema,
  type VideoProject
} from "../../schema/video-project.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "./project-repository.js";
import { createEmptyVideoProject } from "./empty-video-project.js";
import { applyEditedScript } from "./script-invalidation.js";
import { normalizeEditedScriptIds } from "./current-script-domain.js";
import { ScriptValidationError } from "./script-errors.js";

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

}

export { ProjectService as ProjectApplicationService };
