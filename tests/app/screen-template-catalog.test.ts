import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ScreenTemplateCatalogService,
  ScreenTemplateRepository,
  ScreenTemplateRevisionConflictError,
  STANDARD_SCREEN_TEMPLATE_ID,
  createStandardScreenTemplate,
  resetScreenTemplateElementsToCanonicalDefaults,
  screenTemplateContentHash
} from "../../src/app/screen-templates/index.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  screenTemplateElementSchema,
  screenTemplateSchema,
  type ScreenTemplate
} from "../../src/schema/screen-template.js";
import {
  assertValidScreenTemplate,
  rotatedScreenRectBounds,
  screenTemplateValidationReport
} from "../../src/validation/screen-templates.js";

const FIXED_TIMESTAMP = "2026-08-17T00:00:00.000Z";

describe("screen template catalog", { timeout: 30_000 }, () => {
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

  async function openDatabase() {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-screen-template-")
    );
    roots.push(workspaceRoot);
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    databases.push(database);
    return {
      database,
      repository: new ScreenTemplateRepository(database.database),
      service: new ScreenTemplateCatalogService({
        repository: new ScreenTemplateRepository(database.database),
        now: () => new Date(FIXED_TIMESTAMP)
      }),
      workspaceRoot
    };
  }

  function customTemplate(templateId: string): ScreenTemplate {
    const standard = createStandardScreenTemplate(FIXED_TIMESTAMP);
    return assertValidScreenTemplate({
      ...standard,
      templateId,
      name: `Template ${templateId}`,
      description: "Custom template",
      elements: standard.elements.map((element, index) => ({
        ...element,
        elementId: `${templateId}-${element.type}-${index}`
      }))
    });
  }

  it("migrates the catalog tables and seeds the standard template on startup", async () => {
    const first = await openDatabase();
    expect(
      first.database.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('screen_templates', 'screen_template_elements') ORDER BY name"
        )
        .all()
    ).toEqual([
      { name: "screen_template_elements" },
      { name: "screen_templates" }
    ]);
    expect(first.repository.list()).toHaveLength(1);
    expect(first.repository.listActive()).toHaveLength(1);
    expect(first.repository.findById(STANDARD_SCREEN_TEMPLATE_ID)).toEqual(
      createStandardScreenTemplate(
        first.repository.findById(STANDARD_SCREEN_TEMPLATE_ID)!.createdAt
      )
    );
    expect(
      first.repository
        .findById(STANDARD_SCREEN_TEMPLATE_ID)!
        .elements.find((element) => element.type === "dialogue-window")
    ).toMatchObject({
      backgroundColor: "#000000",
      backgroundOpacity: 0.4
    });
    const firstSnapshot = first.repository.list();
    first.database.close();

    const secondDatabase = await initializeWorkspaceDatabase({
      workspaceRoot: first.workspaceRoot
    });
    databases.push(secondDatabase);
    const secondRepository = new ScreenTemplateRepository(
      secondDatabase.database
    );
    expect(secondRepository.list()).toEqual(firstSnapshot);
    expect(
      secondDatabase.connection
        .prepare("SELECT COUNT(*) AS count FROM screen_templates")
        .get()
    ).toEqual({ count: 1 });
  });

  it("does not overwrite an existing standard row during a later startup seed", async () => {
    const { database, repository, workspaceRoot } = await openDatabase();
    const original = repository.findById(STANDARD_SCREEN_TEMPLATE_ID)!;
    const edited = assertValidScreenTemplate({
      ...original,
      status: "inactive",
      revision: original.revision + 2,
      updatedAt: "2026-08-17T01:00:00.000Z",
      elements: original.elements.map((element) =>
        element.type === "content-slot"
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { ...element.transform.rect, x: 0.1 }
              }
            }
          : element
      )
    });
    repository.replace(edited);
    const expected = repository.findById(STANDARD_SCREEN_TEMPLATE_ID);
    database.close();

    const reopened = await initializeWorkspaceDatabase({
      workspaceRoot
    });
    databases.push(reopened);
    expect(
      new ScreenTemplateRepository(reopened.database).findById(
        STANDARD_SCREEN_TEMPLATE_ID
      )
    ).toEqual(expected);
  });

  it("saves and reloads validated templates with deterministic ordering", async () => {
    const { repository, service } = await openDatabase();
    const template = customTemplate("custom-template");
    const saved = repository.insert(template);
    expect(saved).toEqual(template);
    expect(repository.list().map((candidate) => candidate.templateId)).toEqual([
      "custom-template",
      STANDARD_SCREEN_TEMPLATE_ID
    ]);
    expect(repository.findById(template.templateId)).toEqual(template);

    const editedElements = template.elements.map((element) =>
      element.type === "dialogue-window"
        ? { ...element, backgroundColor: "#123456", backgroundOpacity: 0.7 }
        : element
    );
    const updated = service.update(
      template.templateId,
      {
        name: template.name,
        description: template.description,
        status: "inactive",
        elements: editedElements
      },
      template.revision
    );
    expect(updated.revision).toBe(template.revision + 1);
    expect(
      updated.elements.find((element) => element.type === "dialogue-window")
    ).toMatchObject({
      backgroundColor: "#123456",
      backgroundOpacity: 0.7
    });
    expect(() =>
      service.update(
        template.templateId,
        {
          name: template.name,
          description: template.description,
          status: "active",
          elements: template.elements
        },
        template.revision
      )
    ).toThrow(ScreenTemplateRevisionConflictError);
    expect(
      repository.listActive().map((candidate) => candidate.templateId)
    ).toEqual([STANDARD_SCREEN_TEMPLATE_ID]);
  });

  it("rejects invalid cardinality, geometry, rotation, and strict config input", () => {
    const template = customTemplate("validation-template");
    const dialogue = template.elements.find(
      (element) => element.type === "dialogue-window"
    )!;
    expect(
      screenTemplateSchema.safeParse({
        ...template,
        elements: template.elements.filter(
          (element) => element.type !== "dialogue-window"
        )
      }).success
    ).toBe(false);
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element) =>
          element.type === "character-visual"
            ? { ...element, slot: "speaker-1" }
            : element
        )
      })
    ).toThrow();
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element, index) =>
          index === 0
            ? { ...element, elementId: template.elements[1]!.elementId }
            : element
        )
      })
    ).toThrow();
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element) =>
          element.type === "content-slot"
            ? { ...element, slot: "secondary" }
            : element
        )
      })
    ).toThrow();
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element) =>
          element.elementId === dialogue.elementId
            ? {
                ...element,
                transform: {
                  ...element.transform,
                  rect: { ...element.transform.rect, width: 0 }
                }
              }
            : element
        )
      })
    ).toThrow();
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element) =>
          element.elementId === dialogue.elementId
            ? {
                ...element,
                transform: {
                  ...element.transform,
                  rect: { ...element.transform.rect, x: Number.NaN }
                }
              }
            : element
        )
      })
    ).toThrow();
    expect(() =>
      assertValidScreenTemplate({
        ...template,
        elements: template.elements.map((element) =>
          element.type === "dialogue-window"
            ? { ...element, fontSize: Number.POSITIVE_INFINITY }
            : element
        )
      })
    ).toThrow();

    const rotated = screenTemplateSchema.parse({
      ...template,
      elements: template.elements.map((element) =>
        element.type === "section-title"
          ? {
              ...element,
              transform: {
                rect: { x: 0.9, y: 0.4, width: 0.1, height: 0.1 },
                rotationDeg: 45
              }
            }
          : element
      )
    });
    expect(rotatedScreenRectBounds(rotated.elements[0]!)).toMatchObject({
      right: expect.any(Number)
    });
    expect(screenTemplateValidationReport(rotated).errors).not.toHaveLength(0);

    for (const rotationDeg of [0, 90, 180, 270, 360]) {
      const edgeTouching = screenTemplateSchema.parse({
        ...template,
        elements: template.elements.map((element) =>
          element.type === "section-title"
            ? {
                ...element,
                transform: {
                  rect: { x: 0, y: 0.4, width: 0.1, height: 0.1 },
                  rotationDeg
                }
              }
            : element
        )
      });
      expect(screenTemplateValidationReport(edgeTouching).errors).toEqual([]);
    }

    const unknownKey = screenTemplateElementSchema.safeParse({
      ...dialogue,
      unexpected: true
    });
    expect(unknownKey.success).toBe(false);
  });

  it("allows partial character overflow but rejects fully off-canvas visuals", () => {
    const standard = createStandardScreenTemplate(FIXED_TIMESTAMP);
    const withCharacterRect = (
      rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      },
      rotationDeg = 0
    ) =>
      screenTemplateSchema.parse({
        ...standard,
        elements: standard.elements.map((element) =>
          element.type === "character-visual" && element.slot === "speaker-1"
            ? {
                ...element,
                transform: { rect, rotationDeg }
              }
            : element
        )
      });

    const rotatedPartial = withCharacterRect(
      { x: -0.08, y: 0.48, width: 0.34, height: 0.6 },
      18
    );
    expect(screenTemplateValidationReport(rotatedPartial).errors).toEqual([]);
    expect(assertValidScreenTemplate(rotatedPartial)).toEqual(rotatedPartial);

    const expandedPartial = withCharacterRect({
      x: -0.2,
      y: -0.15,
      width: 1.2,
      height: 1.3
    });
    expect(screenTemplateValidationReport(expandedPartial).errors).toEqual([]);

    const rightEdgeRotation = withCharacterRect(
      { x: 1.01, y: 0.45, width: 0.2, height: 0.4 },
      45
    );
    expect(screenTemplateValidationReport(rightEdgeRotation).errors).toEqual(
      []
    );

    const fullyOffCanvas = withCharacterRect({
      x: -1.2,
      y: 0.4,
      width: 0.2,
      height: 0.2
    });
    expect(screenTemplateValidationReport(fullyOffCanvas).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "character visual bounds must intersect the canvas"
        })
      ])
    );
    expect(() => assertValidScreenTemplate(fullyOffCanvas)).toThrow(
      "character visual bounds must intersect the canvas"
    );

    const containedElementOverflow = screenTemplateSchema.safeParse({
      ...standard,
      elements: standard.elements.map((element) =>
        element.type === "dialogue-window"
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { ...element.transform.rect, x: -0.01 }
              }
            }
          : element
      )
    });
    expect(containedElementOverflow.success).toBe(false);

    for (const rect of [
      { x: Number.NaN, y: 0, width: 0.2, height: 0.2 },
      { x: Number.POSITIVE_INFINITY, y: 0, width: 0.2, height: 0.2 },
      { x: 0, y: 0, width: 0, height: 0.2 },
      { x: 0, y: 0, width: -0.2, height: 0.2 }
    ]) {
      expect(
        screenTemplateSchema.safeParse({
          ...standard,
          elements: standard.elements.map((element) =>
            element.type === "character-visual" && element.slot === "speaker-1"
              ? { ...element, transform: { ...element.transform, rect } }
              : element
          )
        }).success
      ).toBe(false);
    }
  });

  it("round-trips character overflow through numeric catalog columns", async () => {
    const { repository, service } = await openDatabase();
    const template = customTemplate("overflow-template");
    const overflow = assertValidScreenTemplate({
      ...template,
      elements: template.elements.map((element) =>
        element.type === "character-visual" && element.slot === "speaker-1"
          ? {
              ...element,
              transform: {
                rect: { x: -0.08, y: 0.5, width: 1.1, height: 0.5 },
                rotationDeg: 12
              }
            }
          : element
      )
    });
    repository.insert(overflow);
    expect(repository.findById(overflow.templateId)).toEqual(overflow);

    const updated = service.update(
      overflow.templateId,
      {
        name: overflow.name,
        description: overflow.description,
        elements: resetScreenTemplateElementsToCanonicalDefaults(
          overflow.elements
        )
      },
      overflow.revision
    );
    expect(updated.revision).toBe(overflow.revision + 1);
    expect(updated.elements).toEqual(
      createStandardScreenTemplate(FIXED_TIMESTAMP).elements.map(
        (canonical, index) => ({
          ...canonical,
          elementId: overflow.elements[index]!.elementId
        })
      )
    );
  });

  it("resets editable values from the canonical seed while preserving row identity", () => {
    const standard = createStandardScreenTemplate(FIXED_TIMESTAMP);
    const editedElements = standard.elements.map((element, index) => {
      const editedTransform = {
        rect: {
          x: 0.01 * (index + 1),
          y: 0.02 * (index + 1),
          width: 0.2 + 0.01 * index,
          height: 0.2 + 0.01 * index
        },
        rotationDeg: index + 3
      };
      if (element.type === "dialogue-window") {
        return { ...element, transform: editedTransform, fontSize: 61 };
      }
      if (element.type === "section-title") {
        return { ...element, transform: editedTransform, fontSize: 62 };
      }
      if (element.type === "character-visual") {
        return { ...element, transform: editedTransform, flipX: true };
      }
      return { ...element, transform: editedTransform };
    });
    const reset =
      resetScreenTemplateElementsToCanonicalDefaults(editedElements);

    expect(reset).toEqual(
      standard.elements.map((canonical, index) => ({
        ...canonical,
        elementId: editedElements[index]!.elementId
      }))
    );
    expect(reset).not.toBe(editedElements);

    const resetTemplate = {
      ...standard,
      templateId: "edited-template",
      name: "Edited name",
      description: "Edited description",
      status: "inactive" as const,
      revision: 7,
      elements: reset
    };
    expect(resetTemplate).toMatchObject({
      templateId: "edited-template",
      name: "Edited name",
      description: "Edited description",
      status: "inactive",
      revision: 7
    });
    expect(resetTemplate.elements.map((element) => element.elementId)).toEqual(
      editedElements.map((element) => element.elementId)
    );
  });

  it("rejects unknown config keys when reading SQLite rows", async () => {
    const { database, repository } = await openDatabase();
    database.connection
      .prepare(
        "UPDATE screen_template_elements SET config_json = ? WHERE element_id = ?"
      )
      .run(
        JSON.stringify({ fontSize: 38, unexpected: true }),
        "screen-template-standard-dialogue-window"
      );
    expect(() => repository.findById(STANDARD_SCREEN_TEMPLATE_ID)).toThrow();
  });

  it("keeps content hashes stable for bookkeeping changes and changes them for render changes", async () => {
    const { repository } = await openDatabase();
    const template = repository.findById(STANDARD_SCREEN_TEMPLATE_ID)!;
    const hash = screenTemplateContentHash(template);
    expect(
      screenTemplateContentHash({
        ...template,
        status: "inactive",
        revision: template.revision + 1,
        updatedAt: "2026-08-17T03:00:00.000Z"
      })
    ).toBe(hash);
    expect(
      screenTemplateContentHash({
        ...template,
        name: "Renamed template",
        description: "Updated catalog description",
        elements: template.elements.map((element, index) => ({
          ...element,
          elementId: `renamed-element-${index}`
        }))
      })
    ).toBe(hash);
    expect(
      screenTemplateContentHash({
        ...template,
        elements: template.elements.map((element) =>
          element.type === "content-slot"
            ? {
                ...element,
                transform: {
                  ...element.transform,
                  rect: { ...element.transform.rect, width: 0.81 }
                }
              }
            : element
        )
      })
    ).not.toBe(hash);
  });

  it("rolls back template and element replacement as one transaction", async () => {
    const { repository } = await openDatabase();
    const template = customTemplate("transaction-template");
    repository.insert(template);
    const conflicting = assertValidScreenTemplate({
      ...template,
      revision: 2,
      elements: template.elements.map((element, index) =>
        index === 0
          ? {
              ...element,
              elementId: "screen-template-standard-dialogue-window"
            }
          : element
      )
    });
    expect(() => repository.replace(conflicting)).toThrow();
    expect(repository.findById(template.templateId)).toEqual(template);
  });

  it("reports containment warnings without making intentional layer overlap invalid", () => {
    const standard = createStandardScreenTemplate(FIXED_TIMESTAMP);
    const sectionTitle = standard.elements.find(
      (element) => element.type === "section-title"
    )!;
    const template = assertValidScreenTemplate({
      ...standard,
      elements: [
        ...standard.elements.filter((element) => element !== sectionTitle),
        {
          ...sectionTitle,
          transform: {
            rect: {
              x: 0.03125,
              y: 0.05555555555555555,
              width: 0.9375,
              height: 0.8888888888888888
            },
            rotationDeg: 0
          }
        }
      ]
    });
    const report = screenTemplateValidationReport(template);
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});
