import { createHash } from "node:crypto";

import type { ApiErrorDetail } from "../../schema/api.js";
import { idSchema, type Outline, type Script, type VideoProject } from "../../schema/index.js";
import { STANDARD_SCREEN_TEMPLATE_ID } from "../screen-templates/screen-template-seed.js";
import {
  ScriptApprovalError,
  ScriptInitializationError,
  ScriptValidationError
} from "./script-errors.js";

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

export function computeOutlineHash(outline: Outline): string {
  const { status, ...content } = outline;
  void status;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(content)), "utf8")
    .digest("hex");
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

export function createScriptFromApprovedOutline(
  outline: Outline,
  createId: () => string
): Script {
  const usedIds = new Set<string>();
  return {
    sections: outline.sections.map((outlineSection) => ({
      id: generatedId("script-section", createId, usedIds),
      name: outlineSection.title,
      enabled: true,
      background: { kind: "solid", colorToken: "background" },
      screenTemplateId: STANDARD_SCREEN_TEMPLATE_ID,
      lines: []
    }))
  };
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

function assertMatchingSectionStructure(
  current: Script,
  candidate: Script
): void {
  if (current.sections.length !== candidate.sections.length) {
    throw new ScriptValidationError([
      {
        path: ["script", "sections"],
        message: "script sections cannot be added, removed, or reordered"
      }
    ]);
  }

  for (const [index, currentSection] of current.sections.entries()) {
    if (candidate.sections[index]?.id !== currentSection.id) {
      throw new ScriptValidationError([
        {
          path: ["script", "sections", index, "id"],
          message: "script sections must keep their stable IDs"
        }
      ]);
    }
  }
}

export function normalizeEditedScriptIds(
  currentProject: VideoProject,
  candidate: Script,
  createId: () => string
): Script {
  assertUniqueLineIds(candidate);
  assertMatchingSectionStructure(currentProject.script, candidate);

  const currentLineIds = new Set(scriptLineEntries(currentProject.script).map(({ line }) => line.id));
  const usedLineIds = new Set<string>();
  const scriptSections = candidate.sections.map((section, sectionIndex) => ({
    ...section,
    id: currentProject.script.sections[sectionIndex]?.id ?? section.id,
    lines: section.lines.map((line) => ({
      ...line,
      id: currentLineIds.has(line.id)
        ? (usedLineIds.add(line.id), line.id)
        : generatedId("script-line", createId, usedLineIds)
    }))
  }));

  return {
    ...candidate,
    sections: scriptSections
  };
}

export function scriptContentChanged(current: Script, candidate: Script): boolean {
  return JSON.stringify(canonicalize(current.sections)) !==
    JSON.stringify(canonicalize(candidate.sections));
}

export function assertCanInitializeScript(
  project: VideoProject,
  currentSourceHash: string
): void {
  void currentSourceHash;
  if (project.script.sections.length > 0) {
    throw new ScriptInitializationError([
      {
        path: ["script", "sections"],
        message: "script has already been initialized"
      }
    ]);
  }

}

export function assertCanApproveScript(
  project: VideoProject,
  currentSourceHash: string
): void {
  void currentSourceHash;
  const details: ApiErrorDetail[] = [];
  if (project.script.sections.length === 0) {
    details.push({
      path: ["script", "sections"],
      message: "台本が初期化されていません。"
    });
  }
  if (details.length > 0) {
    throw new ScriptApprovalError(details);
  }
}
