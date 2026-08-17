import { asc, eq } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import { screenTemplateElements, screenTemplates } from "../../db/schema.js";
import {
  screenTemplateElementSchema,
  type ScreenTemplate,
  type ScreenTemplateCatalogSnapshot,
  type ScreenTemplateElement,
  type ScreenTemplateStatus
} from "../../schema/screen-template.js";
import { assertValidScreenTemplate } from "../../validation/screen-templates.js";
import { ScreenTemplateRepositoryError } from "./screen-template-errors.js";

type ScreenTemplateDatabase = WorkspaceDatabase;
type ScreenTemplateRow = typeof screenTemplates.$inferSelect;
type ScreenTemplateElementRow = typeof screenTemplateElements.$inferSelect;
type ScreenTemplateElementInsert = typeof screenTemplateElements.$inferInsert;

export type ScreenTemplateListOptions = Readonly<{
  status?: ScreenTemplateStatus;
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
): ScreenTemplateRepositoryError["constraint"] {
  const code = databaseErrorCode(error);
  if (
    code !== "SQLITE_CONSTRAINT_UNIQUE" &&
    code !== "SQLITE_CONSTRAINT_PRIMARYKEY" &&
    code !== "SQLITE_CONSTRAINT"
  ) {
    return "unknown";
  }

  const message = databaseErrorMessage(error);
  if (message.includes("screen_templates.template_id")) {
    return "templateId";
  }
  if (message.includes("screen_template_elements.element_id")) {
    return "elementId";
  }
  return "unknown";
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (
      error instanceof ScreenTemplateRepositoryError ||
      (error instanceof Error && error.name === "ScreenTemplateValidationError")
    ) {
      throw error;
    }
    throw new ScreenTemplateRepositoryError(constraintFor(error), error);
  }
}

function parseConfigJson(
  row: ScreenTemplateElementRow
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.configJson);
  } catch (error) {
    throw new ScreenTemplateRepositoryError("unknown", error);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ScreenTemplateRepositoryError(
      "unknown",
      new Error("screen template element config must be an object")
    );
  }

  const expectedKeys =
    row.elementType === "dialogue-window" || row.elementType === "section-title"
      ? ["fontSize"]
      : row.elementType === "character-visual"
        ? ["slot", "flipX"]
        : ["slot"];
  const keys = Object.keys(parsed);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new ScreenTemplateRepositoryError(
      "unknown",
      new Error(
        `screen template ${row.elementType} config contains unknown keys`
      )
    );
  }
  return parsed as Record<string, unknown>;
}

function toElement(row: ScreenTemplateElementRow): ScreenTemplateElement {
  const config = parseConfigJson(row);
  try {
    return screenTemplateElementSchema.parse({
      ...config,
      elementId: row.elementId,
      type: row.elementType,
      transform: {
        rect: {
          x: row.x,
          y: row.y,
          width: row.width,
          height: row.height
        },
        rotationDeg: row.rotationDeg
      }
    });
  } catch (error) {
    throw new ScreenTemplateRepositoryError("unknown", error);
  }
}

function toTemplate(
  row: ScreenTemplateRow,
  elementRows: readonly ScreenTemplateElementRow[]
): ScreenTemplate {
  return assertValidScreenTemplate({
    templateId: row.templateId,
    name: row.name,
    description: row.description,
    status: row.status,
    canvasWidth: row.canvasWidth,
    canvasHeight: row.canvasHeight,
    revision: row.revision,
    elements: [...elementRows]
      .sort(
        (left, right) =>
          left.orderIndex - right.orderIndex ||
          left.elementId.localeCompare(right.elementId)
      )
      .map(toElement),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function elementConfig(
  element: ScreenTemplateElement
): Record<string, unknown> {
  if (element.type === "dialogue-window" || element.type === "section-title") {
    return { fontSize: element.fontSize };
  }
  if (element.type === "character-visual") {
    return { slot: element.slot, flipX: element.flipX };
  }
  return { slot: element.slot };
}

function toElementInsert(
  template: ScreenTemplate,
  element: ScreenTemplateElement,
  orderIndex: number
): ScreenTemplateElementInsert {
  return {
    elementId: element.elementId,
    templateId: template.templateId,
    elementType: element.type,
    x: element.transform.rect.x,
    y: element.transform.rect.y,
    width: element.transform.rect.width,
    height: element.transform.rect.height,
    rotationDeg: element.transform.rotationDeg,
    orderIndex,
    configJson: JSON.stringify(elementConfig(element)),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function templateValues(template: ScreenTemplate) {
  return {
    templateId: template.templateId,
    name: template.name,
    description: template.description,
    status: template.status,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    revision: template.revision,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

export class ScreenTemplateRepository {
  private readonly database: ScreenTemplateDatabase;

  constructor(database: ScreenTemplateDatabase) {
    this.database = database;
  }

  list(options: ScreenTemplateListOptions = {}): ScreenTemplateCatalogSnapshot {
    return withDatabaseErrors(() => {
      const templateQuery = this.database
        .select()
        .from(screenTemplates)
        .orderBy(asc(screenTemplates.templateId));
      const templateRows =
        options.status === undefined
          ? templateQuery.all()
          : this.database
              .select()
              .from(screenTemplates)
              .where(eq(screenTemplates.status, options.status))
              .orderBy(asc(screenTemplates.templateId))
              .all();
      const elementRows = this.database
        .select()
        .from(screenTemplateElements)
        .orderBy(
          asc(screenTemplateElements.templateId),
          asc(screenTemplateElements.orderIndex),
          asc(screenTemplateElements.elementId)
        )
        .all();
      const elementsByTemplateId = new Map<
        string,
        ScreenTemplateElementRow[]
      >();
      for (const elementRow of elementRows) {
        const elements = elementsByTemplateId.get(elementRow.templateId) ?? [];
        elements.push(elementRow);
        elementsByTemplateId.set(elementRow.templateId, elements);
      }
      return templateRows.map((templateRow) =>
        toTemplate(
          templateRow,
          elementsByTemplateId.get(templateRow.templateId) ?? []
        )
      );
    });
  }

  listActive(): ScreenTemplateCatalogSnapshot {
    return this.list({ status: "active" });
  }

  findById(templateId: string): ScreenTemplate | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(screenTemplates)
        .where(eq(screenTemplates.templateId, templateId))
        .get();
      if (row === undefined) {
        return undefined;
      }
      const elements = this.database
        .select()
        .from(screenTemplateElements)
        .where(eq(screenTemplateElements.templateId, templateId))
        .orderBy(
          asc(screenTemplateElements.orderIndex),
          asc(screenTemplateElements.elementId)
        )
        .all();
      return toTemplate(row, elements);
    });
  }

  insert(template: ScreenTemplate): ScreenTemplate {
    const validated = assertValidScreenTemplate(template);
    return withDatabaseErrors(() => {
      this.database.transaction((transaction) => {
        transaction
          .insert(screenTemplates)
          .values(templateValues(validated))
          .run();
        transaction
          .insert(screenTemplateElements)
          .values(
            validated.elements.map((element, orderIndex) =>
              toElementInsert(validated, element, orderIndex)
            )
          )
          .run();
      });
      const inserted = this.findById(validated.templateId);
      if (inserted === undefined) {
        throw new ScreenTemplateRepositoryError("templateId");
      }
      return inserted;
    });
  }

  replace(template: ScreenTemplate): ScreenTemplate {
    const validated = assertValidScreenTemplate(template);
    return withDatabaseErrors(() => {
      this.database.transaction((transaction) => {
        transaction
          .update(screenTemplates)
          .set(templateValues(validated))
          .where(eq(screenTemplates.templateId, validated.templateId))
          .run();
        transaction
          .delete(screenTemplateElements)
          .where(eq(screenTemplateElements.templateId, validated.templateId))
          .run();
        transaction
          .insert(screenTemplateElements)
          .values(
            validated.elements.map((element, orderIndex) =>
              toElementInsert(validated, element, orderIndex)
            )
          )
          .run();
      });
      const replaced = this.findById(validated.templateId);
      if (replaced === undefined) {
        throw new ScreenTemplateRepositoryError("templateId");
      }
      return replaced;
    });
  }

  transaction<T>(operation: (repository: ScreenTemplateRepository) => T): T {
    return this.database.transaction((transaction) =>
      operation(
        new ScreenTemplateRepository(
          transaction as unknown as ScreenTemplateDatabase
        )
      )
    );
  }
}
