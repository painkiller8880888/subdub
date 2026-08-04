import type { Outline, VideoProject } from "../../schema/video-project.js";

export function hasMeaningfulOutline(outline: Outline): boolean {
  return (
    outline.sections.length > 0 ||
    outline.openQuestions.length > 0 ||
    outline.generationRunId !== null ||
    outline.status !== "draft"
  );
}

function hasMeaningfulScript(project: VideoProject): boolean {
  return project.script.sections.length > 0 || project.script.status !== "draft";
}

function hasMeaningfulVisuals(project: VideoProject): boolean {
  return (
    project.visuals.assignments.length > 0 ||
    project.visuals.suggestionRunIds.length > 0 ||
    project.visuals.status !== "draft"
  );
}

function withoutStatus(outline: Outline): Omit<Outline, "status"> {
  const { status, ...content } = outline;
  void status;
  return content;
}

export function outlineContentChanged(
  current: Outline,
  candidate: Outline
): boolean {
  return JSON.stringify(withoutStatus(current)) !== JSON.stringify(withoutStatus(candidate));
}

export function applyEditedOutline(
  currentProject: VideoProject,
  submittedOutline: Outline
): { project: VideoProject; contentChanged: boolean } {
  const contentChanged = outlineContentChanged(
    currentProject.outline,
    submittedOutline
  );
  const hasContent =
    hasMeaningfulOutline(currentProject.outline) || hasMeaningfulOutline(submittedOutline);
  const sourceHash = hasMeaningfulOutline(currentProject.outline)
    ? currentProject.outline.sourceHash
    : currentProject.source.sha256;
  const nextOutline: Outline = {
    ...submittedOutline,
    status: hasContent
      ? contentChanged
        ? "needs_review"
        : currentProject.outline.status
      : "draft",
    sourceHash,
    generationRunId: currentProject.outline.generationRunId,
    openQuestions: submittedOutline.openQuestions.map((question) => ({ ...question })),
    sections: submittedOutline.sections.map((section) => ({
      ...section,
      keyPoints: [...section.keyPoints],
      sourceRefs: section.sourceRefs.map((sourceRef) => ({
        ...sourceRef,
        headingPath: [...sourceRef.headingPath]
      })),
      openQuestions: section.openQuestions.map((question) => ({ ...question })),
      humanDirectives: {
        requiredItems: [...section.humanDirectives.requiredItems],
        prohibitedItems: [...section.humanDirectives.prohibitedItems],
        scriptConstraints: [...section.humanDirectives.scriptConstraints]
      },
      lockedFields: [...section.lockedFields]
    }))
  };

  let project: VideoProject = {
    ...currentProject,
    outline: nextOutline
  };
  if (contentChanged && currentProject.outline.status === "approved") {
    if (hasMeaningfulScript(project)) {
      project = {
        ...project,
        script: { ...project.script, status: "needs_review" }
      };
    }
    if (hasMeaningfulVisuals(project)) {
      project = {
        ...project,
        visuals: { ...project.visuals, status: "needs_review" }
      };
    }
  }

  return { project, contentChanged };
}

export function invalidateForUpstreamChange(project: VideoProject): VideoProject {
  let nextProject = project;
  if (hasMeaningfulOutline(project.outline)) {
    nextProject = {
      ...nextProject,
      outline: { ...project.outline, status: "needs_review" }
    };
  }
  if (hasMeaningfulScript(project)) {
    nextProject = {
      ...nextProject,
      script: { ...project.script, status: "needs_review" }
    };
  }
  if (hasMeaningfulVisuals(project)) {
    nextProject = {
      ...nextProject,
      visuals: { ...project.visuals, status: "needs_review" }
    };
  }
  return nextProject;
}
