import type {
  Outline,
  VideoProject,
  VideoProjectV18
} from "../../schema/video-project.js";

export function hasMeaningfulOutline(outline: Outline): boolean {
  return (
    outline.sections.length > 0 ||
    outline.openQuestions.length > 0 ||
    outline.generationRunId !== null ||
    outline.status !== "draft"
  );
}

function hasMeaningfulScript(project: VideoProjectV18): boolean {
  return project.script.sections.length > 0;
}

export function hasMeaningfulVisuals(
  project: Pick<VideoProject, "visuals">
): boolean {
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
  currentProject: VideoProject | VideoProjectV18,
  submittedOutline: Outline
): { project: VideoProject | VideoProjectV18; contentChanged: boolean } {
  if (!("outline" in currentProject)) {
    return { project: currentProject, contentChanged: false };
  }
  const legacyProject = currentProject as unknown as VideoProjectV18;
  const contentChanged = outlineContentChanged(
    legacyProject.outline,
    submittedOutline
  );
  const hasContent =
    hasMeaningfulOutline(legacyProject.outline) ||
    hasMeaningfulOutline(submittedOutline);
  const sourceHash = hasMeaningfulOutline(legacyProject.outline)
    ? legacyProject.outline.sourceHash
    : legacyProject.source.sha256;
  const nextOutline: Outline = {
    ...submittedOutline,
    status: hasContent
      ? contentChanged
        ? "needs_review"
        : legacyProject.outline.status
      : "draft",
    sourceHash,
    generationRunId: legacyProject.outline.generationRunId,
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

  let project: VideoProjectV18 = {
    ...legacyProject,
    outline: nextOutline
  };
  if (contentChanged && legacyProject.outline.status === "approved") {
    if (hasMeaningfulScript(project)) {
      project = {
        ...project,
        script: { ...project.script }
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

export function invalidateForUpstreamChange(
  project: VideoProject | VideoProjectV18
): VideoProject | VideoProjectV18 {
  if (!("outline" in project)) {
    return project;
  }
  const legacyProject = project as unknown as VideoProjectV18;
  let nextProject: VideoProjectV18 = legacyProject;
  if (hasMeaningfulOutline(legacyProject.outline)) {
    nextProject = {
      ...nextProject,
      outline: { ...legacyProject.outline, status: "needs_review" }
    };
  }
  if (hasMeaningfulScript(legacyProject)) {
    nextProject = {
      ...nextProject,
      script: { ...legacyProject.script }
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
