import { describe, expect, it } from "vitest";

import {
  compileRenderManifest,
  type RenderManifestCompileResult
} from "../../src/app/rendering/render-manifest-compiler.js";
import { insertTextTemplateContentHash } from "../../src/app/insert-text-templates/insert-text-template-hash.js";
import {
  insertTextTemplateSchema,
  type InsertTextTemplate
} from "../../src/schema/insert-text-template.js";
import type { VideoProject } from "../../src/schema/video-project.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const TEMPLATE_TIMESTAMP = "2026-08-17T00:00:00.000Z";

function template(
  overrides: Partial<InsertTextTemplate> = {}
): InsertTextTemplate {
  return insertTextTemplateSchema.parse({
    templateId: "insert-text-template-lower-third",
    name: "Lower third",
    description: "Reusable overlay",
    status: "active",
    revision: 4,
    createdAt: TEMPLATE_TIMESTAMP,
    updatedAt: TEMPLATE_TIMESTAMP,
    canvasWidth: 1920,
    canvasHeight: 1080,
    textRect: { x: 0.08, y: 0.72, width: 0.84, height: 0.18 },
    rotationDeg: -1.5,
    fontSize: 56,
    fontWeight: 700,
    textColor: "#12abef",
    textAlign: "center",
    verticalAlign: "center",
    ...overrides
  });
}

function projectWithInsert(
  text: string,
  textTemplateId: string | null = "insert-text-template-lower-third"
): VideoProject {
  const project = structuredClone(videoProjectFixture) as VideoProject;
  const videoAssignment = project.visuals.assignments.find(
    (assignment) => assignment.display.kind === "video"
  );
  if (videoAssignment === undefined) {
    throw new Error("fixture video assignment is missing");
  }
  project.edit.videoElements = [
    {
      id: "edit-intro",
      role: "intro",
      assetId: videoAssignment.assetId,
      assetVersion: 1,
      assetChecksum: videoAssignment.assetChecksum,
      projectMediaPath: videoAssignment.projectMediaPath,
      placement: { kind: "before_first_section" },
      volume: 0.25,
      text,
      textTemplateId
    }
  ];
  return project;
}

function diagnosticCodes(result: RenderManifestCompileResult): string[] {
  return result.success ? [] : result.diagnostics.map(({ code }) => code);
}

describe("RenderManifest 2.7.0 insert text snapshots", () => {
  it("snapshots multiline text and resolved template layout for intro, cutin, and outro", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const videoAssignment = project.visuals.assignments.find(
      (assignment) => assignment.display.kind === "video"
    );
    if (videoAssignment === undefined) {
      throw new Error("fixture video assignment is missing");
    }
    const selectedTemplate = template();
    const makeElement = (
      id: string,
      role: "intro" | "cutin" | "outro",
      placement: VideoProject["edit"]["videoElements"][number]["placement"]
    ) => ({
      id,
      role,
      assetId: videoAssignment.assetId,
      assetVersion: 1,
      assetChecksum: videoAssignment.assetChecksum,
      projectMediaPath: videoAssignment.projectMediaPath,
      placement,
      volume: 0.25,
      text: "一行目\n二行目",
      textTemplateId: selectedTemplate.templateId
    });
    project.edit.videoElements = [
      makeElement("edit-intro", "intro", {
        kind: "before_first_section"
      }),
      makeElement("edit-cutin", "cutin", {
        kind: "before_section",
        sectionId: "section-main",
        order: 0
      }),
      makeElement("edit-outro", "outro", {
        kind: "after_last_section"
      })
    ];

    const result = compileRenderManifest(
      createRenderManifestInput(project, {
        insertTextTemplateCatalogSnapshot: [selectedTemplate]
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.manifest.manifestVersion).toBe("2.7.0");
    expect(result.manifest.inserts.map((insert) => insert.role)).toEqual([
      "intro",
      "cutin",
      "outro"
    ]);
    for (const insert of result.manifest.inserts) {
      expect(insert.text).toEqual({
        templateId: selectedTemplate.templateId,
        templateRevision: selectedTemplate.revision,
        templateHash: insertTextTemplateContentHash(selectedTemplate),
        text: "一行目\n二行目",
        resolvedTextLayout: {
          rect: selectedTemplate.textRect,
          rotationDeg: selectedTemplate.rotationDeg,
          fontSize: selectedTemplate.fontSize,
          fontWeight: selectedTemplate.fontWeight,
          textColor: selectedTemplate.textColor,
          textAlign: selectedTemplate.textAlign,
          verticalAlign: selectedTemplate.verticalAlign
        }
      });
    }
  });

  it("keeps empty text and an explicitly unselected template overlay-free", () => {
    const selected = compileRenderManifest(
      createRenderManifestInput(projectWithInsert(""), {
        insertTextTemplateCatalogSnapshot: [template()]
      })
    );
    const unselected = compileRenderManifest(
      createRenderManifestInput(projectWithInsert("文字", null), {
        insertTextTemplateCatalogSnapshot: [template()]
      })
    );

    expect(selected.success).toBe(true);
    expect(unselected.success).toBe(true);
    if (!selected.success || !unselected.success) {
      return;
    }
    expect(selected.manifest.inserts[0]?.text).toBeNull();
    expect(unselected.manifest.inserts[0]?.text).toBeNull();
  });

  it("rejects missing or inactive references without silently substituting a template", () => {
    const missing = compileRenderManifest(
      createRenderManifestInput(projectWithInsert("文字"), {
        insertTextTemplateCatalogSnapshot: []
      })
    );
    const inactive = compileRenderManifest(
      createRenderManifestInput(projectWithInsert("文字"), {
        insertTextTemplateCatalogSnapshot: [template({ status: "inactive" })]
      })
    );

    expect(diagnosticCodes(missing)).toContain("INSERT_TEXT_TEMPLATE_MISSING");
    expect(diagnosticCodes(inactive)).toContain(
      "INSERT_TEXT_TEMPLATE_INACTIVE"
    );
  });

  it("changes the compiler hash and snapshot revision when template layout changes", () => {
    const project = projectWithInsert("固定文字");
    const firstTemplate = template();
    const first = compileRenderManifest(
      createRenderManifestInput(project, {
        insertTextTemplateCatalogSnapshot: [firstTemplate]
      })
    );
    const secondTemplate = template({
      revision: firstTemplate.revision + 1,
      updatedAt: "2026-08-17T01:00:00.000Z",
      textRect: { ...firstTemplate.textRect, y: 0.62 }
    });
    const second = compileRenderManifest(
      createRenderManifestInput(project, {
        insertTextTemplateCatalogSnapshot: [secondTemplate]
      })
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) {
      return;
    }
    expect(second.manifest.compilerInputHash).not.toBe(
      first.manifest.compilerInputHash
    );
    expect(second.manifest.inserts[0]?.text).toMatchObject({
      templateRevision: secondTemplate.revision,
      templateHash: insertTextTemplateContentHash(secondTemplate),
      resolvedTextLayout: { rect: secondTemplate.textRect }
    });
  });
});
