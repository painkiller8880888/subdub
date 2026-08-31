import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  outlineApproveRequestSchema,
  outlineRejectRequestSchema,
  outlineReviewRequestSchema,
  outlineSaveRequestSchema,
  projectBriefSaveRequestSchema,
  projectCharactersSaveRequestSchema,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectEditResponseSchema,
  projectEditSaveRequestSchema,
  projectListResponseSchema,
  projectLineOverlaysSaveRequestSchema,
  projectMutationResponseSchema,
  projectSourceReadResponseSchema,
  projectSourceSaveRequestSchema,
  scriptApproveRequestSchema,
  scriptInitializeRequestSchema,
  scriptSaveRequestSchema
} from "../../schema/api.js";
import { ProjectService } from "../../app/projects/project-service.js";
import { ProjectEditService } from "../../app/projects/project-edit-service.js";

export type ProjectEditServicePort = Pick<ProjectEditService, "read" | "save">;

export function registerProjectRoutes(
  app: FastifyInstance,
  projectService: ProjectService,
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

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/source",
    async (request) => {
      const source = await projectService.readSource(request.params.projectId);
      return projectSourceReadResponseSchema.parse(
        createApiSuccessResponse(
          { markdown: source.markdown, sha256: source.sha256 },
          source.revision
        )
      );
    }
  );

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/source",
    async (request) => {
      const input = projectSourceSaveRequestSchema.parse(request.body);
      const project = await projectService.saveSource(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.put<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/brief",
    async (request) => {
      const input = projectBriefSaveRequestSchema.parse(request.body);
      const project = await projectService.saveBrief(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
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
    "/api/projects/:projectId/outline",
    async (request) => {
      const input = outlineSaveRequestSchema.parse(request.body);
      const project = await projectService.saveOutline(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/script/initialize",
    async (request) => {
      const input = scriptInitializeRequestSchema.parse(request.body);
      const project = await projectService.initializeScript(
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

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/script/approve",
    async (request) => {
      const input = scriptApproveRequestSchema.parse(request.body);
      const project = await projectService.approveScript(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/outline/approve",
    async (request) => {
      const input = outlineApproveRequestSchema.parse(request.body);
      const project = await projectService.approveOutline(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/outline/reject",
    async (request) => {
      const input = outlineRejectRequestSchema.parse(request.body);
      const project = await projectService.rejectOutline(
        request.params.projectId,
        input
      );
      return projectMutationResponseSchema.parse(
        createApiSuccessResponse(project, project.revision)
      );
    }
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/outline/review",
    async (request) => {
      const input = outlineReviewRequestSchema.parse(request.body);
      const project = await projectService.reviewOutline(
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
