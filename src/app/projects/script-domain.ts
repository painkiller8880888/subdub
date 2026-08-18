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
    status: "draft",
    origin: "manual",
    outlineHash: computeOutlineHash(outline),
    sections: outline.sections.map((outlineSection) => ({
      id: generatedId("script-section", createId, usedIds),
      outlineSectionId: outlineSection.id,
      name: outlineSection.title,
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
    if (candidate.sections[index]?.outlineSectionId !== currentSection.outlineSectionId) {
      throw new ScriptValidationError([
        {
          path: ["script", "sections", index, "outlineSectionId"],
          message: "script sections must keep the outline order"
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
    origin: currentProject.script.origin,
    outlineHash: currentProject.script.outlineHash,
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
  if (project.script.sections.length > 0) {
    throw new ScriptInitializationError([
      {
        path: ["script", "sections"],
        message: "script has already been initialized"
      }
    ]);
  }

  const details = [];
  if (project.outline.status !== "approved") {
    details.push({
      path: ["outline", "status"],
      message: "an approved outline is required before starting the script"
    });
  }
  if (project.outline.sourceHash !== currentSourceHash) {
    details.push({
      path: ["outline", "sourceHash"],
      message: "the outline is stale and must be reviewed"
    });
  }
  if (details.length > 0) {
    throw new ScriptInitializationError(details);
  }
}

export function assertCanApproveScript(
  project: VideoProject,
  currentSourceHash: string
): void {
  const details: ApiErrorDetail[] = [];
  if (project.script.sections.length === 0) {
    details.push({
      path: ["script", "sections"],
      message: "台本が初期化されていません。"
    });
  }
  if (project.outline.status !== "approved") {
    details.push({
      path: ["outline", "status"],
      message: "構成案が承認されていません。"
    });
  }
  if (project.outline.sourceHash !== currentSourceHash) {
    details.push({
      path: ["outline", "sourceHash"],
      message: "構成案が stale です。構成案を見直してください。"
    });
  }
  if (computeOutlineHash(project.outline) !== project.script.outlineHash) {
    details.push({
      path: ["script", "outlineHash"],
      message: "台本の元となった構成案が変更されています。"
    });
  }
  if (details.length > 0) {
    throw new ScriptApprovalError(details);
  }
}
