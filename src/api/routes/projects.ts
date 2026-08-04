import type { FastifyInstance } from "fastify";

import {
  createApiSuccessResponse,
  projectCreateRequestSchema,
  projectCreateResponseSchema,
  projectDetailResponseSchema,
  projectListResponseSchema
} from "../../schema/api.js";
import { ProjectService } from "../../app/projects/project-service.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  projectService: ProjectService
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
}
