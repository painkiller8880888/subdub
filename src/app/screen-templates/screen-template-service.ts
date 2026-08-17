import { randomUUID } from "node:crypto";

import {
  type ScreenTemplate,
  type ScreenTemplateCatalogSnapshot,
  type ScreenTemplateElement,
  type ScreenTemplateStatus
} from "../../schema/screen-template.js";
import { assertValidScreenTemplate } from "../../validation/screen-templates.js";
import {
  ScreenTemplateNotFoundError,
  ScreenTemplateRevisionConflictError
} from "./screen-template-errors.js";
import {
  ScreenTemplateRepository,
  type ScreenTemplateListOptions
} from "./screen-template-repository.js";
import {
  createStandardScreenTemplate,
  STANDARD_SCREEN_TEMPLATE_ID
} from "./screen-template-seed.js";

export type ScreenTemplateCatalogServiceOptions = Readonly<{
  repository: ScreenTemplateRepository;
  now?: () => Date;
  createId?: () => string;
}>;

export type ScreenTemplateCreateInput = Readonly<{
  templateId?: string;
  name: string;
  description?: string;
  status?: ScreenTemplateStatus;
  elements: readonly ScreenTemplateElement[];
}>;

export type ScreenTemplateUpdateInput = Readonly<{
  name: string;
  description: string;
  status: ScreenTemplateStatus;
  elements: readonly ScreenTemplateElement[];
}>;

function timestamp(now: () => Date): string {
  return now().toISOString();
}

export class ScreenTemplateCatalogService {
  private readonly repository: ScreenTemplateRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: ScreenTemplateCatalogServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  list(options: ScreenTemplateListOptions = {}): ScreenTemplateCatalogSnapshot {
    return this.repository.list(options);
  }

  listActive(): ScreenTemplateCatalogSnapshot {
    return this.repository.listActive();
  }

  findById(templateId: string): ScreenTemplate | undefined {
    return this.repository.findById(templateId);
  }

  create(input: ScreenTemplateCreateInput): ScreenTemplate {
    const createdAt = timestamp(this.now);
    return this.repository.insert(
      assertValidScreenTemplate({
        templateId: input.templateId ?? this.createId(),
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        status: input.status ?? "active",
        canvasWidth: 1920,
        canvasHeight: 1080,
        revision: 1,
        elements: input.elements,
        createdAt,
        updatedAt: createdAt
      })
    );
  }

  update(
    templateId: string,
    input: ScreenTemplateUpdateInput,
    expectedRevision: number
  ): ScreenTemplate {
    const current = this.repository.findById(templateId);
    if (current === undefined) {
      throw new ScreenTemplateNotFoundError(templateId);
    }
    if (expectedRevision !== current.revision) {
      throw new ScreenTemplateRevisionConflictError(
        templateId,
        expectedRevision,
        current.revision
      );
    }

    return this.repository.replace(
      assertValidScreenTemplate({
        templateId,
        name: input.name.trim(),
        description: input.description.trim(),
        status: input.status,
        canvasWidth: current.canvasWidth,
        canvasHeight: current.canvasHeight,
        revision: current.revision + 1,
        elements: input.elements,
        createdAt: current.createdAt,
        updatedAt: timestamp(this.now)
      })
    );
  }

  /**
   * Seeds only the missing stable ID. Existing rows, including user edits and
   * inactive rows, are intentionally returned unchanged.
   */
  seedStandardTemplate(): ScreenTemplate {
    const existing = this.repository.findById(STANDARD_SCREEN_TEMPLATE_ID);
    if (existing !== undefined) {
      return existing;
    }
    return this.repository.insert(
      createStandardScreenTemplate(timestamp(this.now))
    );
  }
}
