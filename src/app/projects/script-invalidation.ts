import type {
  Script,
  ScriptLine,
  VideoProject
} from "../../schema/video-project.js";
import { hasMeaningfulVisuals } from "./project-invalidation.js";
import { scriptContentChanged } from "./script-domain.js";

export type ScriptStaleTarget = "visuals" | "audio" | "manifest";

export type ScriptChangeImpact = {
  contentChanged: boolean;
  structuralChanged: boolean;
  staleTargets: readonly ScriptStaleTarget[];
};

const STALE_TARGET_ORDER: readonly ScriptStaleTarget[] = [
  "visuals",
  "audio",
  "manifest"
];

function deepEqual(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }
  if (first === null || second === null) {
    return false;
  }
  if (Array.isArray(first)) {
    return (
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((item, index) => deepEqual(item, second[index]))
    );
  }
  if (typeof first === "object" && typeof second === "object") {
    if (Array.isArray(second)) {
      return false;
    }
    const firstRecord = first as Record<string, unknown>;
    const secondRecord = second as Record<string, unknown>;
    const firstKeys = Object.keys(firstRecord).sort();
    const secondKeys = Object.keys(secondRecord).sort();
    if (firstKeys.length !== secondKeys.length) {
      return false;
    }
    return firstKeys.every(
      (key, index) =>
        secondKeys[index] === key &&
        deepEqual(firstRecord[key], secondRecord[key])
    );
  }
  return false;
}

function structureChanged(current: Script, candidate: Script): boolean {
  if (current.sections.length !== candidate.sections.length) {
    return true;
  }

  for (let sectionIndex = 0; sectionIndex < current.sections.length; sectionIndex += 1) {
    if (current.sections[sectionIndex]?.id !== candidate.sections[sectionIndex]?.id) {
      return true;
    }
  }

  const candidateSectionsById = new Map(
    candidate.sections.map((section) => [section.id, section])
  );
  for (const currentSection of current.sections) {
    const candidateSection = candidateSectionsById.get(currentSection.id);
    if (candidateSection === undefined) {
      return true;
    }
    const currentLines = currentSection.lines;
    const candidateLines = candidateSection.lines;
    if (currentLines.length !== candidateLines.length) {
      return true;
    }
    for (let lineIndex = 0; lineIndex < currentLines.length; lineIndex += 1) {
      if (currentLines[lineIndex]?.id !== candidateLines[lineIndex]?.id) {
        return true;
      }
    }
  }

  return false;
}

function audioFieldsChanged(current: ScriptLine, candidate: ScriptLine): boolean {
  return (
    current.spokenText !== candidate.spokenText ||
    current.speakerId !== candidate.speakerId ||
    !deepEqual(current.voiceOverrides, candidate.voiceOverrides) ||
    current.pronunciation.mode !== candidate.pronunciation.mode ||
    !deepEqual(
      current.pronunciation.excludedTermIds,
      candidate.pronunciation.excludedTermIds
    )
  );
}

function manifestFieldsChanged(
  current: ScriptLine,
  candidate: ScriptLine
): boolean {
  return (
    current.subtitleText !== candidate.subtitleText ||
    current.expression !== candidate.expression ||
    current.pauseBeforeMs !== candidate.pauseBeforeMs ||
    current.pauseAfterMs !== candidate.pauseAfterMs
  );
}

function sectionPresentationChanged(
  current: Script,
  candidate: Script
): boolean {
  if (
    current.sections.length !== candidate.sections.length ||
    current.sections.some(
      (section, sectionIndex) =>
        candidate.sections[sectionIndex]?.id !== section.id
    )
  ) {
    return true;
  }

  const candidateSectionsById = new Map(
    candidate.sections.map((section) => [section.id, section])
  );
  return current.sections.some((section) => {
    const candidateSection = candidateSectionsById.get(section.id);
    return (
      candidateSection !== undefined &&
      (section.name !== candidateSection.name ||
        section.enabled !== candidateSection.enabled ||
        !deepEqual(section.background, candidateSection.background) ||
        section.screenTemplateId !== candidateSection.screenTemplateId)
    );
  });
}

function linesById(script: Script): Map<string, ScriptLine> {
  const linesById = new Map<string, ScriptLine>();
  for (const section of script.sections) {
    for (const line of section.lines) {
      linesById.set(line.id, line);
    }
  }
  return linesById;
}

export function classifyScriptChange(
  current: Script,
  candidate: Script
): ScriptChangeImpact {
  const contentChanged = scriptContentChanged(current, candidate);
  const structuralChanged = structureChanged(current, candidate);

  const staleTargets = new Set<ScriptStaleTarget>();
  if (structuralChanged) {
    staleTargets.add("visuals");
    staleTargets.add("audio");
    staleTargets.add("manifest");
  }

  const candidateLines = linesById(candidate);
  for (const currentLine of linesById(current).values()) {
    const candidateLine = candidateLines.get(currentLine.id);
    if (candidateLine === undefined) {
      continue;
    }
    if (audioFieldsChanged(currentLine, candidateLine)) {
      staleTargets.add("audio");
      staleTargets.add("manifest");
    }
    if (manifestFieldsChanged(currentLine, candidateLine)) {
      staleTargets.add("manifest");
    }
  }

  if (sectionPresentationChanged(current, candidate)) {
    staleTargets.add("manifest");
  }

  return {
    contentChanged,
    structuralChanged,
    staleTargets: STALE_TARGET_ORDER.filter((target) => staleTargets.has(target))
  };
}

function linePositions(
  script: Script
): Map<string, { sectionId: string; index: number }> {
  const positions = new Map<string, { sectionId: string; index: number }>();
  for (const section of script.sections) {
    for (const [index, line] of section.lines.entries()) {
      positions.set(line.id, { sectionId: section.id, index });
    }
  }
  return positions;
}

type SectionEndExtension = {
  oldEndLineId: string;
  newEndLineId: string;
};

function appendedSectionEndExtensions(
  current: Script,
  candidate: Script
): Map<string, SectionEndExtension> {
  const candidateSections = new Map(
    candidate.sections.map((section) => [section.id, section])
  );
  const extensions = new Map<string, SectionEndExtension>();

  for (const currentSection of current.sections) {
    const candidateSection = candidateSections.get(currentSection.id);
    const oldEndLine = currentSection.lines.at(-1);
    const newEndLine = candidateSection?.lines.at(-1);
    if (
      candidateSection === undefined ||
      oldEndLine === undefined ||
      newEndLine === undefined ||
      candidateSection.lines.length <= currentSection.lines.length
    ) {
      continue;
    }

    const isAppend = currentSection.lines.every(
      (line, index) => candidateSection.lines[index]?.id === line.id
    );
    if (!isAppend || oldEndLine.id === newEndLine.id) {
      continue;
    }

    extensions.set(currentSection.id, {
      oldEndLineId: oldEndLine.id,
      newEndLineId: newEndLine.id
    });
  }

  return extensions;
}

export function extendSectionEndVisualAssignments(
  current: Script,
  candidate: Script,
  assignments: VideoProject["visuals"]["assignments"]
): VideoProject["visuals"]["assignments"] {
  const extensions = appendedSectionEndExtensions(current, candidate);
  if (extensions.size === 0) {
    return assignments;
  }

  const positions = linePositions(current);
  let changed = false;
  const updatedAssignments = assignments.map((assignment) => {
    const start = positions.get(assignment.startLineId);
    const end = positions.get(assignment.endLineId);
    const extension = end === undefined ? undefined : extensions.get(end.sectionId);
    if (
      start === undefined ||
      end === undefined ||
      extension === undefined ||
      start.sectionId !== end.sectionId ||
      assignment.endLineId !== extension.oldEndLineId
    ) {
      return assignment;
    }

    changed = true;
    return { ...assignment, endLineId: extension.newEndLineId };
  });

  return changed ? updatedAssignments : assignments;
}

export function pruneInvalidatedDownstreamReferences(
  project: VideoProject
): VideoProject {
  const positions = linePositions(project.script);
  const assignments = project.visuals.assignments.filter((assignment) => {
    const start = positions.get(assignment.startLineId);
    const end = positions.get(assignment.endLineId);
    if (start === undefined || end === undefined) {
      return false;
    }
    if (start.sectionId !== end.sectionId) {
      return false;
    }
    return start.index <= end.index;
  });
  const soundEffects = project.audio.soundEffects.filter((effect) =>
    positions.has(effect.lineId)
  );
  const lineOverlays = project.overlays.lineOverlays.filter((overlay) =>
    positions.has(overlay.lineId)
  );
  return {
    ...project,
    visuals: { ...project.visuals, assignments },
    audio: { ...project.audio, soundEffects },
    overlays: { ...project.overlays, lineOverlays }
  };
}

export function applyEditedScript(
  currentProject: VideoProject,
  candidate: Script
): { project: VideoProject; impact: ScriptChangeImpact } {
  const impact = classifyScriptChange(currentProject.script, candidate);
  let project: VideoProject = {
    ...currentProject,
    script: candidate
  };

  if (impact.structuralChanged && hasMeaningfulVisuals(project)) {
    project = {
      ...project,
      visuals: { ...project.visuals, status: "needs_review" }
    };
  }

  if (impact.structuralChanged) {
    project = {
      ...project,
      visuals: {
        ...project.visuals,
        assignments: extendSectionEndVisualAssignments(
          currentProject.script,
          project.script,
          project.visuals.assignments
        )
      }
    };
    project = pruneInvalidatedDownstreamReferences(project);
  }

  return { project, impact };
}
