import type {
  ScriptLine,
  ScriptSection,
  VideoProject
} from "../../schema/video-project.js";

export type ScreenTemplateReference = Readonly<{
  readonly status: "active" | "inactive";
}>;

export type ScreenTemplateCatalogPort = Readonly<{
  findById(templateId: string): ScreenTemplateReference | undefined;
}>;

export type ScreenTemplateReferenceIssue = Readonly<{
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly templateId: string;
  readonly reason: "missing" | "inactive";
}>;

/** Resolve a line's effective template without consulting the workspace catalog. */
export function resolveScreenTemplateId(
  section: Pick<ScriptSection, "screenTemplateId">,
  line: Pick<ScriptLine, "screenTemplateId">
): string {
  return line.screenTemplateId ?? section.screenTemplateId;
}

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

    for (const [lineIndex, line] of section.lines.entries()) {
      if (line.screenTemplateId === null) {
        continue;
      }
      const lineIssue = referenceIssue(
        [
          "script",
          "sections",
          sectionIndex,
          "lines",
          lineIndex,
          "screenTemplateId"
        ],
        line.screenTemplateId,
        catalog.findById(line.screenTemplateId)
      );
      if (lineIssue !== undefined) {
        issues.push(lineIssue);
      }
    }
  }

  return issues;
}
