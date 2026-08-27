import { randomUUID } from "node:crypto";

import {
  type InsertTextTemplate,
  type InsertTextTemplateCatalogSnapshot,
  type InsertTextTemplateStatus
} from "../../schema/insert-text-template.js";
import { assertValidInsertTextTemplate } from "../../validation/insert-text-templates.js";
import {
  InsertTextTemplateNotFoundError,
  InsertTextTemplateRevisionConflictError
} from "./insert-text-template-errors.js";
import {
  InsertTextTemplateRepository,
  type InsertTextTemplateListOptions
} from "./insert-text-template-repository.js";

export type InsertTextTemplateServiceOptions = Readonly<{
  repository: InsertTextTemplateRepository;
  now?: () => Date;
  createId?: () => string;
}>;

export type InsertTextTemplateCreateInput = Readonly<{
  templateId?: string;
  name: string;
  description?: string;
  status?: InsertTextTemplateStatus;
  textRect: InsertTextTemplate["textRect"];
  rotationDeg: number;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  textAlign: InsertTextTemplate["textAlign"];
  verticalAlign: InsertTextTemplate["verticalAlign"];
}>;

export type InsertTextTemplateUpdateInput = Omit<
  InsertTextTemplateCreateInput,
  "templateId" | "status"
> & { status?: InsertTextTemplateStatus };

function timestamp(now: () => Date): string {
  return now().toISOString();
}

export class InsertTextTemplateCatalogService {
  private readonly repository: InsertTextTemplateRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: InsertTextTemplateServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  list(
    options: InsertTextTemplateListOptions = {}
  ): InsertTextTemplateCatalogSnapshot {
    return this.repository.list(options);
  }

  listActive(): InsertTextTemplateCatalogSnapshot {
    return this.repository.listActive();
  }

  findById(templateId: string): InsertTextTemplate | undefined {
    return this.repository.findById(templateId);
  }

  create(input: InsertTextTemplateCreateInput): InsertTextTemplate {
    const createdAt = timestamp(this.now);
    return this.repository.insert(
      assertValidInsertTextTemplate({
        templateId: input.templateId ?? this.createId(),
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        status: input.status ?? "active",
        revision: 1,
        canvasWidth: 1920,
        canvasHeight: 1080,
        textRect: input.textRect,
        rotationDeg: input.rotationDeg,
        fontSize: input.fontSize,
        fontWeight: input.fontWeight,
        textColor: input.textColor,
        textAlign: input.textAlign,
        verticalAlign: input.verticalAlign,
        createdAt,
        updatedAt: createdAt
      })
    );
  }

  update(
    templateId: string,
    input: InsertTextTemplateUpdateInput,
    expectedRevision: number
  ): InsertTextTemplate {
    const current = this.repository.findById(templateId);
    if (current === undefined) {
      throw new InsertTextTemplateNotFoundError(templateId);
    }
    if (expectedRevision !== current.revision) {
      throw new InsertTextTemplateRevisionConflictError(
        templateId,
        expectedRevision,
        current.revision
      );
    }

    return this.repository.replace(
      assertValidInsertTextTemplate({
        ...current,
        name: input.name.trim(),
        description: input.description?.trim() ?? current.description,
        status: input.status ?? current.status,
        textRect: input.textRect,
        rotationDeg: input.rotationDeg,
        fontSize: input.fontSize,
        fontWeight: input.fontWeight,
        textColor: input.textColor,
        textAlign: input.textAlign,
        verticalAlign: input.verticalAlign,
        revision: current.revision + 1,
        updatedAt: timestamp(this.now)
      })
    );
  }

  deactivate(templateId: string, expectedRevision: number): InsertTextTemplate {
    return this.changeStatus(templateId, "inactive", expectedRevision);
  }

  activate(templateId: string, expectedRevision: number): InsertTextTemplate {
    return this.changeStatus(templateId, "active", expectedRevision);
  }

  private changeStatus(
    templateId: string,
    status: InsertTextTemplateStatus,
    expectedRevision: number
  ): InsertTextTemplate {
    const current = this.repository.findById(templateId);
    if (current === undefined) {
      throw new InsertTextTemplateNotFoundError(templateId);
    }
    if (expectedRevision !== current.revision) {
      throw new InsertTextTemplateRevisionConflictError(
        templateId,
        expectedRevision,
        current.revision
      );
    }
    if (current.status === status) {
      return current;
    }
    return this.repository.replace({
      ...current,
      status,
      revision: current.revision + 1,
      updatedAt: timestamp(this.now)
    });
  }
}
