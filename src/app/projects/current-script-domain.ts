import type {
  Script,
  VideoProject
} from "../../schema/video-project.js";
import { idSchema } from "../../schema/primitives.js";
import { createScriptSection } from "./starter-script-sections.js";
import { ScriptValidationError } from "./script-errors.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])])
    );
  }
  throw new Error("Unsupported value in canonical project data.");
}

function generatedId(
  prefix: string,
  createId: () => string,
  usedIds: Set<string>
): string {
  const seed = createId()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "generated";
  let suffix = 1;
  let candidate = `${prefix}-${seed}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${seed}-${suffix}`;
  }
  usedIds.add(candidate);
  return idSchema.parse(candidate);
}

function scriptSectionEntries(script: Script) {
  return script.sections.map((section, sectionIndex) => ({
    section,
    sectionIndex,
    path: ["script", "sections", sectionIndex] as Array<string | number>
  }));
}

function scriptLineEntries(script: Script) {
  return script.sections.flatMap((section, sectionIndex) =>
    section.lines.map((line, lineIndex) => ({
      line,
      sectionIndex,
      lineIndex,
      path: ["script", "sections", sectionIndex, "lines", lineIndex] as Array<
        string | number
      >
    }))
  );
}

function assertUniqueLineIds(script: Script): void {
  const seen = new Set<string>();
  for (const entry of scriptLineEntries(script)) {
    if (seen.has(entry.line.id)) {
      throw new ScriptValidationError([
        {
          path: [...entry.path, "id"],
          message: "script line id must be unique"
        }
      ]);
    }
    seen.add(entry.line.id);
  }
}

function assertUniqueSectionIds(script: Script): void {
  const seen = new Set<string>();
  for (const entry of scriptSectionEntries(script)) {
    if (seen.has(entry.section.id)) {
      throw new ScriptValidationError([
        {
          path: [...entry.path, "id"],
          message: "script section id must be unique"
        }
      ]);
    }
    seen.add(entry.section.id);
  }
}

export function assertNoRemovedScriptSections(
  current: Script,
  candidate: Script
): void {
  const candidateIds = new Set(candidate.sections.map((section) => section.id));
  const removedSections = current.sections.filter(
    (section) => !candidateIds.has(section.id)
  );
  if (removedSections.length > 0) {
    throw new ScriptValidationError([
      {
        path: ["script", "sections"],
        message:
          "existing script sections cannot be hard-deleted; set enabled=false instead"
      }
    ]);
  }
}

export function normalizeEditedScriptIds(
  currentProject: VideoProject,
  candidate: Script,
  createId: () => string
): Script {
  assertUniqueSectionIds(candidate);
  assertUniqueLineIds(candidate);
  assertNoRemovedScriptSections(currentProject.script, candidate);

  const currentSectionsById = new Map(
    currentProject.script.sections.map((section) => [section.id, section])
  );
  const currentLineIds = new Set(
    scriptLineEntries(currentProject.script).map(({ line }) => line.id)
  );
  const usedSectionIds = new Set(currentSectionsById.keys());
  const usedLineIds = new Set(currentLineIds);
  const scriptSections = candidate.sections.map((section) => {
    const currentSection = currentSectionsById.get(section.id);
    const sectionId =
      currentSection?.id ?? generatedId("script-section", createId, usedSectionIds);
    if (currentSection === undefined) {
      // A client-provided section is a creation request. Allocate its identity
      // here and start it from the canonical empty-section defaults.
      return createScriptSection(sectionId, section.name);
    }

    return {
      ...section,
      id: currentSection.id,
      lines: section.lines.map((line) => ({
        ...line,
        id: currentLineIds.has(line.id)
          ? line.id
          : generatedId("script-line", createId, usedLineIds)
      }))
    };
  });

  return {
    ...candidate,
    sections: scriptSections
  };
}

export function scriptContentChanged(current: Script, candidate: Script): boolean {
  return JSON.stringify(canonicalize(current.sections)) !==
    JSON.stringify(canonicalize(candidate.sections));
}
