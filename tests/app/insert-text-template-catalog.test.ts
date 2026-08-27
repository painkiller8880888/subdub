import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InsertTextTemplateCatalogService,
  InsertTextTemplateRepository,
  InsertTextTemplateRevisionConflictError
} from "../../src/app/insert-text-templates/index.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  insertTextTemplateSchema,
  type InsertTextTemplate
} from "../../src/schema/insert-text-template.js";
import { assertValidInsertTextTemplate } from "../../src/validation/insert-text-templates.js";

const FIXED_TIMESTAMP = "2026-08-17T00:00:00.000Z";

function template(
  templateId = "insert-text-template-default",
  overrides: Partial<InsertTextTemplate> = {}
): InsertTextTemplate {
  return insertTextTemplateSchema.parse({
    templateId,
    name: "Default insert text",
    description: "A reusable overlay",
    status: "active",
    revision: 1,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    canvasWidth: 1920,
    canvasHeight: 1080,
    textRect: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
    rotationDeg: 0,
    fontSize: 64,
    fontWeight: 700,
    textColor: "#ffffff",
    textAlign: "center",
    verticalAlign: "center",
    ...overrides
  });
}

describe("insert text template catalog", { timeout: 30_000 }, () => {
  const roots: string[] = [];
  const databases: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>[] =
    [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      if (database.connection.open) {
        database.close();
      }
    }
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function openCatalog() {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-insert-text-template-")
    );
    roots.push(workspaceRoot);
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    databases.push(database);
    const repository = new InsertTextTemplateRepository(database.database);
    const service = new InsertTextTemplateCatalogService({
      repository,
      now: () => new Date(FIXED_TIMESTAMP),
      createId: () => "insert-text-template-created"
    });
    return { database, repository, service };
  }

  it("creates the independent 1920x1080 catalog and preserves revisions", async () => {
    const { database, repository, service } = await openCatalog();
    expect(
      database.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'insert_text_templates'"
        )
        .all()
    ).toEqual([{ name: "insert_text_templates" }]);

    const created = service.create({
      name: "  Lower third  ",
      description: "  Intro and cutin  ",
      textRect: { x: 0.05, y: 0.8, width: 0.9, height: 0.12 },
      rotationDeg: -2.5,
      fontSize: 52,
      fontWeight: 600,
      textColor: "#12abEF",
      textAlign: "left",
      verticalAlign: "bottom"
    });
    expect(created).toMatchObject({
      templateId: "insert-text-template-created",
      name: "Lower third",
      description: "Intro and cutin",
      canvasWidth: 1920,
      canvasHeight: 1080,
      revision: 1
    });
    expect(repository.listActive()).toEqual([created]);

    const updated = service.update(
      created.templateId,
      {
        name: created.name,
        description: created.description,
        status: "inactive",
        textRect: { ...created.textRect, y: 0.72 },
        rotationDeg: created.rotationDeg,
        fontSize: created.fontSize,
        fontWeight: created.fontWeight,
        textColor: created.textColor,
        textAlign: created.textAlign,
        verticalAlign: created.verticalAlign
      },
      created.revision
    );
    expect(updated.revision).toBe(2);
    expect(updated.status).toBe("inactive");
    expect(updated.textRect.y).toBe(0.72);
    expect(repository.listActive()).toEqual([]);
    expect(repository.list({ status: "inactive" })).toEqual([updated]);

    expect(() =>
      service.update(
        created.templateId,
        {
          name: updated.name,
          description: updated.description,
          textRect: updated.textRect,
          rotationDeg: updated.rotationDeg,
          fontSize: updated.fontSize,
          fontWeight: updated.fontWeight,
          textColor: updated.textColor,
          textAlign: updated.textAlign,
          verticalAlign: updated.verticalAlign
        },
        created.revision
      )
    ).toThrow(InsertTextTemplateRevisionConflictError);

    const reactivated = service.activate(updated.templateId, updated.revision);
    expect(reactivated).toMatchObject({ status: "active", revision: 3 });
    expect(repository.listActive()).toEqual([reactivated]);
  });

  it("rejects invalid color, geometry, alignment, and canvas values", () => {
    const valid = template();
    const invalidValues: unknown[] = [
      { ...valid, textColor: "#fff" },
      { ...valid, textRect: { x: 0.9, y: 0, width: 0.2, height: 0.2 } },
      { ...valid, textAlign: "justify" },
      { ...valid, verticalAlign: "middle" },
      { ...valid, canvasWidth: 1280 }
    ];

    for (const invalid of invalidValues) {
      expect(() => assertValidInsertTextTemplate(invalid)).toThrow();
    }
  });
});
