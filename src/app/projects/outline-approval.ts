import type { ApiErrorDetail } from "../../schema/api.js";
import type { VideoProject } from "../../schema/video-project.js";

export const OUTLINE_APPROVAL_ERROR_CODE =
  "OUTLINE_APPROVAL_VALIDATION_FAILED" as const;

export class OutlineApprovalError extends Error {
  readonly code = OUTLINE_APPROVAL_ERROR_CODE;
  readonly status = 422 as const;
  readonly details: readonly ApiErrorDetail[];

  constructor(details: readonly ApiErrorDetail[]) {
    super("The outline does not meet the approval requirements.");
    this.name = "OutlineApprovalError";
    this.stack = undefined;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}

function addIssue(
  details: ApiErrorDetail[],
  path: Array<string | number>,
  message: string
): void {
  details.push({ path, message });
}

function validateQuestions(
  questions: VideoProject["outline"]["openQuestions"],
  pathPrefix: Array<string | number>,
  details: ApiErrorDetail[]
): void {
  for (const [questionIndex, question] of questions.entries()) {
    const path = [...pathPrefix, questionIndex];
    if (question.status === "open") {
      addIssue(details, [...path, "status"], "open question is unresolved");
      if (question.resolution !== null) {
        addIssue(
          details,
          [...path, "resolution"],
          "an open question must have a null resolution"
        );
      }
      continue;
    }

    if (question.resolution === null || question.resolution.trim().length === 0) {
      addIssue(
        details,
        [...path, "resolution"],
        "a resolved question must have a non-empty resolution"
      );
    }
  }
}

export function validateOutlineForApproval(
  project: VideoProject,
  currentSourceHash: string
): void {
  const details: ApiErrorDetail[] = [];
  const { outline } = project;

  if (outline.sections.length < 3) {
    addIssue(
      details,
      ["outline", "sections"],
      "outline must contain an intro, at least one main section, and an outro"
    );
  }

  if (outline.sections[0]?.role !== "intro") {
    addIssue(
      details,
      ["outline", "sections", 0, "role"],
      "the first section must have role intro"
    );
  }

  const lastSectionIndex = outline.sections.length - 1;
  if (outline.sections[lastSectionIndex]?.role !== "outro") {
    addIssue(
      details,
      ["outline", "sections", Math.max(0, lastSectionIndex), "role"],
      "the last section must have role outro"
    );
  }

  const mainSections = outline.sections.slice(1, -1);
  if (mainSections.length === 0 || !mainSections.some((section) => section.role === "main")) {
    addIssue(
      details,
      ["outline", "sections"],
      "outline must contain at least one main section"
    );
  }

  const seenOrders = new Set<number>();
  for (const [sectionIndex, section] of outline.sections.entries()) {
    if (sectionIndex > 0 && sectionIndex < lastSectionIndex && section.role !== "main") {
      addIssue(
        details,
        ["outline", "sections", sectionIndex, "role"],
        "only main sections may appear between intro and outro"
      );
    }
    if (seenOrders.has(section.order)) {
      addIssue(
        details,
        ["outline", "sections", sectionIndex, "order"],
        "section order must be unique"
      );
    }
    seenOrders.add(section.order);
    if (section.order !== sectionIndex + 1) {
      addIssue(
        details,
        ["outline", "sections", sectionIndex, "order"],
        "section order must match the display order"
      );
    }
  }

  validateQuestions(outline.openQuestions, ["outline", "openQuestions"], details);
  for (const [sectionIndex, section] of outline.sections.entries()) {
    validateQuestions(
      section.openQuestions,
      ["outline", "sections", sectionIndex, "openQuestions"],
      details
    );
  }

  if (outline.sourceHash !== currentSourceHash) {
    addIssue(
      details,
      ["outline", "sourceHash"],
      "outline sourceHash must match the current source"
    );
  }

  if (details.length > 0) {
    throw new OutlineApprovalError(details);
  }
}
