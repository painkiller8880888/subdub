import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  projectCharactersSaveRequestSchema,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectEditResponseSchema,
  projectEditSaveRequestSchema,
  projectListResponseSchema,
  projectLineOverlaysSaveRequestSchema,
  projectMutationResponseSchema,
  scriptSaveRequestSchema
} from "../../schema/api.js";
import type { ProjectService } from "../../app/projects/project-service.js";
import type { ProjectEditService } from "../../app/projects/project-edit-service.js";

export type ProjectEditServicePort = Pick<ProjectEditService, "read" | "save">;
export type ProjectServicePort = Pick<
  ProjectService,
  | "list"
  | "create"
  | "read"
  | "saveCharacterVisualBindings"
  | "saveScript"
  | "saveLineOverlays"
>;

export function registerProjectRoutes(
  app: FastifyInstance,
  projectService: ProjectServicePort,
  projectEditService?: ProjectEditServicePort
): void {
  app.get("/api/projects", async () => {
    const projects = await projectService.list();
    return projectListResponseSchema.parse(createApiSuccessResponse(projects));
  });

  app.post("/api/projects", async (request) => {
    const input = projectCreateRequestSchema.parse(request.body);
    const project = await projectService.create(input);
    return projectCreateResponseSchema.parse(
      createApiSuccessResponse(project, 0)
    );
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request) => {
      const project = await projectService.read(request.params.projectId);
      return projectDetailResponseSchema.parse(
        createApiSuccessResponse(project)
      );
    }
  );

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/characters",
    async (request) => {
      const input = projectCharactersSaveRequestSchema.parse(request.body);
      const project = await projectService.saveCharacterVisualBindings(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/script",
    async (request) => {
      const input = scriptSaveRequestSchema.parse(request.body);
      const project = await projectService.saveScript(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/overlays",
    async (request) => {
      const input = projectLineOverlaysSaveRequestSchema.parse(request.body);
      const project = await projectService.saveLineOverlays(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  if (projectEditService !== undefined) {
    app.get<{ Params: { projectId: string } }>(
      "/api/projects/:projectId/edit",
      async (request) => {
        const result = await projectEditService.read(request.params.projectId);
        return projectEditResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );

    app.put<{ Params: { projectId: string } }>(
      "/api/projects/:projectId/edit",
      async (request) => {
        const input = projectEditSaveRequestSchema.parse(request.body);
        const result = await projectEditService.save(
          request.params.projectId,
          input
        );
        return projectMutationResponseSchema.parse(
          createApiSuccessResponse(result.data, result.revision)
        );
      }
    );
  }
}
