import { asc, eq } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import { insertTextTemplates } from "../../db/schema.js";
import {
  insertTextTemplateSchema,
  type InsertTextTemplate,
  type InsertTextTemplateCatalogSnapshot,
  type InsertTextTemplateStatus
} from "../../schema/insert-text-template.js";
import { assertValidInsertTextTemplate } from "../../validation/insert-text-templates.js";
import { InsertTextTemplateRepositoryError } from "./insert-text-template-errors.js";

type InsertTextTemplateRow = typeof insertTextTemplates.$inferSelect;

export type InsertTextTemplateListOptions = Readonly<{
  status?: InsertTextTemplateStatus;
}>;

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function databaseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function constraintFor(
  error: unknown
): InsertTextTemplateRepositoryError["constraint"] {
  const code = databaseErrorCode(error);
  if (
    code !== "SQLITE_CONSTRAINT_UNIQUE" &&
    code !== "SQLITE_CONSTRAINT_PRIMARYKEY" &&
    code !== "SQLITE_CONSTRAINT"
  ) {
    return "unknown";
  }
  return databaseErrorMessage(error).includes(
    "insert_text_templates.template_id"
  )
    ? "templateId"
    : "unknown";
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (
      error instanceof InsertTextTemplateRepositoryError ||
      (error instanceof Error &&
        error.name === "InsertTextTemplateValidationError")
    ) {
      throw error;
    }
    throw new InsertTextTemplateRepositoryError(constraintFor(error), error);
  }
}

function toTemplate(row: InsertTextTemplateRow): InsertTextTemplate {
  return insertTextTemplateSchema.parse({
    templateId: row.templateId,
    name: row.name,
    description: row.description,
    status: row.status,
    revision: row.revision,
    canvasWidth: row.canvasWidth,
    canvasHeight: row.canvasHeight,
    textRect: {
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height
    },
    rotationDeg: row.rotationDeg,
    fontSize: row.fontSize,
    fontWeight: row.fontWeight,
    textColor: row.textColor,
    textAlign: row.textAlign,
    verticalAlign: row.verticalAlign,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function templateValues(template: InsertTextTemplate) {
  return {
    templateId: template.templateId,
    name: template.name,
    description: template.description,
    status: template.status,
    revision: template.revision,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    x: template.textRect.x,
    y: template.textRect.y,
    width: template.textRect.width,
    height: template.textRect.height,
    rotationDeg: template.rotationDeg,
    fontSize: template.fontSize,
    fontWeight: template.fontWeight,
    textColor: template.textColor,
    textAlign: template.textAlign,
    verticalAlign: template.verticalAlign,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

export class InsertTextTemplateRepository {
  private readonly database: WorkspaceDatabase;

  constructor(database: WorkspaceDatabase) {
    this.database = database;
  }

  list(
    options: InsertTextTemplateListOptions = {}
  ): InsertTextTemplateCatalogSnapshot {
    return withDatabaseErrors(() => {
      const query = this.database
        .select()
        .from(insertTextTemplates)
        .orderBy(asc(insertTextTemplates.templateId));
      const rows =
        options.status === undefined
          ? query.all()
          : this.database
              .select()
              .from(insertTextTemplates)
              .where(eq(insertTextTemplates.status, options.status))
              .orderBy(asc(insertTextTemplates.templateId))
              .all();
      return rows.map(toTemplate);
    });
  }

  listActive(): InsertTextTemplateCatalogSnapshot {
    return this.list({ status: "active" });
  }

  findById(templateId: string): InsertTextTemplate | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(insertTextTemplates)
        .where(eq(insertTextTemplates.templateId, templateId))
        .get();
      return row === undefined ? undefined : toTemplate(row);
    });
  }

  insert(template: InsertTextTemplate): InsertTextTemplate {
    const validated = assertValidInsertTextTemplate(template);
    return withDatabaseErrors(() => {
      this.database
        .insert(insertTextTemplates)
        .values(templateValues(validated))
        .run();
      const inserted = this.findById(validated.templateId);
      if (inserted === undefined) {
        throw new InsertTextTemplateRepositoryError("templateId");
      }
      return inserted;
    });
  }

  replace(template: InsertTextTemplate): InsertTextTemplate {
    const validated = assertValidInsertTextTemplate(template);
    return withDatabaseErrors(() => {
      this.database
        .update(insertTextTemplates)
        .set(templateValues(validated))
        .where(eq(insertTextTemplates.templateId, validated.templateId))
        .run();
      const replaced = this.findById(validated.templateId);
      if (replaced === undefined) {
        throw new InsertTextTemplateRepositoryError("templateId");
      }
      return replaced;
    });
  }
}
