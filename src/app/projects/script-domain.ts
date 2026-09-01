import { createHash } from "node:crypto";

import type { ApiErrorDetail } from "../../schema/api.js";
import {
  idSchema,
  type Outline,
  type Script,
  type VideoProject
} from "../../schema/index.js";
import { createScriptSection } from "./starter-script-sections.js";
import {
  ScriptApprovalError,
  ScriptInitializationError
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
    sections: outline.sections.map((outlineSection) =>
      createScriptSection(
        generatedId("script-section", createId, usedIds),
        outlineSection.title
      )
    )
  };
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
