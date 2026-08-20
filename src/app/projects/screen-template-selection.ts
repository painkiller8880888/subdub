import type { VideoProject } from "../../schema/video-project.js";
import type { ScreenTemplate } from "../../schema/screen-template.js";

export type ScreenTemplateReference = Readonly<{
  readonly status: "active" | "inactive";
}>;

export type ScreenTemplateCatalogPort = Readonly<{
  findById(templateId: string): ScreenTemplateReference | undefined;
}>;

/**
 * Render-manifest compilation needs the complete validated template row, not
 * only the active/inactive reference exposed to project editing services.
 */
export type ScreenTemplateSnapshotPort = Readonly<{
  findById(templateId: string): ScreenTemplate | undefined;
}>;

export type ScreenTemplateReferenceIssue = Readonly<{
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly templateId: string;
  readonly reason: "missing" | "inactive";
}>;

function referenceIssue(
  path: readonly (string | number)[],
  templateId: string,
  template: ScreenTemplateReference | undefined
): ScreenTemplateReferenceIssue | undefined {
  if (template === undefined) {
    return {
      path,
      templateId,
      reason: "missing",
      message: "selected screen template does not exist"
    };
  }
  if (template.status !== "active") {
    return {
      path,
      templateId,
      reason: "inactive",
      message: "selected screen template is inactive"
    };
  }
  return undefined;
}

/**
 * Validates live catalog references while preserving the project JSON as the
 * source of truth. The helper intentionally does not rewrite missing or
 * inactive IDs.
 */
export function validateVideoProjectScreenTemplateReferences(
  project: Pick<VideoProject, "script">,
  catalog: ScreenTemplateCatalogPort
): ScreenTemplateReferenceIssue[] {
  const issues: ScreenTemplateReferenceIssue[] = [];

  for (const [sectionIndex, section] of project.script.sections.entries()) {
    const sectionIssue = referenceIssue(
      ["script", "sections", sectionIndex, "screenTemplateId"],
      section.screenTemplateId,
      catalog.findById(section.screenTemplateId)
    );
    if (sectionIssue !== undefined) {
      issues.push(sectionIssue);
    }

  }

  return issues;
}
