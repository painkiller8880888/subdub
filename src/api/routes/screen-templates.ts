import type { FastifyInstance } from "fastify";

import {
  ScreenTemplateCatalogService,
  STANDARD_SCREEN_TEMPLATE_ID
} from "../../app/screen-templates/index.js";
import type { ScreenTemplate } from "../../schema/screen-template.js";
import {
  createApiSuccessResponse,
  screenTemplateCreateRequestSchema,
  screenTemplateDetailSchema,
  screenTemplateListQuerySchema,
  screenTemplateListResponseSchema,
  screenTemplateParamsSchema,
  screenTemplateResponseSchema,
  screenTemplateSummarySchema,
  screenTemplateUpdateRequestSchema
} from "../../schema/api.js";
import { ScreenTemplateNotFoundError } from "../../app/screen-templates/screen-template-errors.js";
import { screenTemplateContentHash } from "../../app/screen-templates/screen-template-hash.js";

export type ScreenTemplateServicePort = Pick<
  ScreenTemplateCatalogService,
  | "list"
  | "findById"
  | "create"
  | "createFromBase"
  | "update"
  | "deactivate"
  | "activate"
>;

function toElementSummary(template: ScreenTemplate) {
  const byType: Record<ScreenTemplate["elements"][number]["type"], number> = {
    "dialogue-window": 0,
    "section-title": 0,
    "character-visual": 0,
    "content-slot": 0
  };

  for (const element of template.elements) {
    byType[element.type] += 1;
  }

  return {
    total: template.elements.length,
    byType
  };
}

function toSummary(template: ScreenTemplate) {
  return screenTemplateSummarySchema.parse({
    templateId: template.templateId,
    name: template.name,
    description: template.description,
    status: template.status,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    revision: template.revision,
    updatedAt: template.updatedAt,
    elementSummary: toElementSummary(template),
    contentHash: screenTemplateContentHash(template)
  });
}

function toDetail(template: ScreenTemplate) {
  return screenTemplateDetailSchema.parse({
    ...template,
    contentHash: screenTemplateContentHash(template)
  });
}

function requireTemplate(
  service: ScreenTemplateServicePort,
  templateId: string
): ScreenTemplate {
  const template = service.findById(templateId);
  if (template === undefined) {
    throw new ScreenTemplateNotFoundError(templateId);
  }
  return template;
}

export function registerScreenTemplateRoutes(
  app: FastifyInstance,
  screenTemplateService: ScreenTemplateServicePort
): void {
  app.get("/api/screen-templates", async (request) => {
    const query = screenTemplateListQuerySchema.parse(request.query);
    return screenTemplateListResponseSchema.parse(
      createApiSuccessResponse(
        screenTemplateService.list({ status: query.status }).map(toSummary)
      )
    );
  });

  app.post("/api/screen-templates", async (request) => {
    const input = screenTemplateCreateRequestSchema.parse(request.body);
    const template =
      input.elements === undefined
        ? screenTemplateService.createFromBase(
            { name: input.name, description: input.description },
            input.baseTemplateId ?? STANDARD_SCREEN_TEMPLATE_ID
          )
        : screenTemplateService.create({
            name: input.name,
            description: input.description,
            elements: input.elements
          });

    return screenTemplateResponseSchema.parse(
      createApiSuccessResponse(toDetail(template))
    );
  });

  app.get<{ Params: { templateId: string } }>(
    "/api/screen-templates/:templateId",
    async (request) => {
      const params = screenTemplateParamsSchema.parse(request.params);
      return screenTemplateResponseSchema.parse(
        createApiSuccessResponse(
          toDetail(requireTemplate(screenTemplateService, params.templateId))
        )
      );
    }
  );

  app.put<{ Params: { templateId: string } }>(
    "/api/screen-templates/:templateId",
    async (request) => {
      const params = screenTemplateParamsSchema.parse(request.params);
      const input = screenTemplateUpdateRequestSchema.parse(request.body);
      const template = screenTemplateService.update(
        params.templateId,
        {
          name: input.name,
          description: input.description,
          elements: input.elements
        },
        input.expectedRevision
      );
      return screenTemplateResponseSchema.parse(
        createApiSuccessResponse(toDetail(template))
      );
    }
  );

  app.post<{ Params: { templateId: string } }>(
    "/api/screen-templates/:templateId/deactivate",
    async (request) => {
      const params = screenTemplateParamsSchema.parse(request.params);
      const template = screenTemplateService.deactivate(params.templateId);
      return screenTemplateResponseSchema.parse(
        createApiSuccessResponse(toDetail(template))
      );
    }
  );

  app.post<{ Params: { templateId: string } }>(
    "/api/screen-templates/:templateId/activate",
    async (request) => {
      const params = screenTemplateParamsSchema.parse(request.params);
      const template = screenTemplateService.activate(params.templateId);
      return screenTemplateResponseSchema.parse(
        createApiSuccessResponse(toDetail(template))
      );
    }
  );
}
