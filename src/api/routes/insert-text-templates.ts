import type { FastifyInstance } from "fastify";

import { InsertTextTemplateCatalogService } from "../../app/insert-text-templates/index.js";
import { InsertTextTemplateNotFoundError } from "../../app/insert-text-templates/insert-text-template-errors.js";
import type { InsertTextTemplate } from "../../schema/insert-text-template.js";
import {
  createApiSuccessResponse,
  insertTextTemplateCreateRequestSchema,
  insertTextTemplateDetailSchema,
  insertTextTemplateListQuerySchema,
  insertTextTemplateListResponseSchema,
  insertTextTemplateParamsSchema,
  insertTextTemplateResponseSchema,
  insertTextTemplateStatusChangeRequestSchema,
  insertTextTemplateSummarySchema,
  insertTextTemplateUpdateRequestSchema
} from "../../schema/api.js";
import { insertTextTemplateContentHash } from "../../app/insert-text-templates/insert-text-template-hash.js";

export type InsertTextTemplateServicePort = Pick<
  InsertTextTemplateCatalogService,
  "list" | "findById" | "create" | "update" | "deactivate" | "activate"
>;

function toSummary(template: InsertTextTemplate) {
  const { createdAt: _createdAt, ...summary } = template;
  void _createdAt;
  return insertTextTemplateSummarySchema.parse({
    ...summary,
    contentHash: insertTextTemplateContentHash(template)
  });
}

function toDetail(template: InsertTextTemplate) {
  return insertTextTemplateDetailSchema.parse({
    ...template,
    contentHash: insertTextTemplateContentHash(template)
  });
}

function requireTemplate(
  service: InsertTextTemplateServicePort,
  templateId: string
): InsertTextTemplate {
  const template = service.findById(templateId);
  if (template === undefined) {
    throw new InsertTextTemplateNotFoundError(templateId);
  }
  return template;
}

export function registerInsertTextTemplateRoutes(
  app: FastifyInstance,
  service: InsertTextTemplateServicePort
): void {
  app.get("/api/insert-text-templates", async (request) => {
    const query = insertTextTemplateListQuerySchema.parse(request.query);
    return insertTextTemplateListResponseSchema.parse(
      createApiSuccessResponse(
        service.list({ status: query.status }).map(toSummary)
      )
    );
  });

  app.post("/api/insert-text-templates", async (request) => {
    const input = insertTextTemplateCreateRequestSchema.parse(request.body);
    const template = service.create(input);
    return insertTextTemplateResponseSchema.parse(
      createApiSuccessResponse(toDetail(template))
    );
  });

  app.get<{ Params: { templateId: string } }>(
    "/api/insert-text-templates/:templateId",
    async (request) => {
      const params = insertTextTemplateParamsSchema.parse(request.params);
      return insertTextTemplateResponseSchema.parse(
        createApiSuccessResponse(
          toDetail(requireTemplate(service, params.templateId))
        )
      );
    }
  );

  app.put<{ Params: { templateId: string } }>(
    "/api/insert-text-templates/:templateId",
    async (request) => {
      const params = insertTextTemplateParamsSchema.parse(request.params);
      const input = insertTextTemplateUpdateRequestSchema.parse(request.body);
      const template = service.update(
        params.templateId,
        input,
        input.expectedRevision
      );
      return insertTextTemplateResponseSchema.parse(
        createApiSuccessResponse(toDetail(template))
      );
    }
  );

  for (const status of ["activate", "deactivate"] as const) {
    app.post<{ Params: { templateId: string } }>(
      `/api/insert-text-templates/:templateId/${status}`,
      async (request) => {
        const params = insertTextTemplateParamsSchema.parse(request.params);
        const input = insertTextTemplateStatusChangeRequestSchema.parse(
          request.body
        );
        const template =
          status === "activate"
            ? service.activate(params.templateId, input.expectedRevision)
            : service.deactivate(params.templateId, input.expectedRevision);
        return insertTextTemplateResponseSchema.parse(
          createApiSuccessResponse(toDetail(template))
        );
      }
    );
  }
}
