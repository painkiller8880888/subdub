import { idSchema, type ScriptSection } from "../../schema/index.js";
import { STANDARD_SCREEN_TEMPLATE_ID } from "../screen-templates/screen-template-seed.js";

export const STARTER_SECTION_SLOTS = [
  { key: "intro", name: "導入" },
  { key: "main", name: "本編" },
  { key: "outro", name: "締め" }
] as const;

export type StarterSectionSlot = (typeof STARTER_SECTION_SLOTS)[number]["key"];

/**
 * These are the canonical defaults for every newly created script section.
 * Keep them here so project creation, migration, and section mutation share
 * one source of truth.
 */
export const DEFAULT_SCRIPT_SECTION_BACKGROUND = {
  kind: "solid",
  colorToken: "background"
} as const;
export const DEFAULT_SCRIPT_SECTION_SCREEN_TEMPLATE_ID =
  STANDARD_SCREEN_TEMPLATE_ID;
export const DEFAULT_SCRIPT_SECTION_NAME = "新しいセクション";

export function createScriptSection(
  id: string,
  name = DEFAULT_SCRIPT_SECTION_NAME
): ScriptSection {
  return {
    id: idSchema.parse(id),
    name,
    enabled: true,
    background: { ...DEFAULT_SCRIPT_SECTION_BACKGROUND },
    screenTemplateId: DEFAULT_SCRIPT_SECTION_SCREEN_TEMPLATE_ID,
    lines: []
  };
}

/**
 * Starter IDs are derived from the project identity and fixed slot, never
 * from the editable section name. This keeps a renamed starter section's
 * references stable while making IDs deterministic across create/migration.
 */
export function starterSectionId(
  projectId: string,
  slot: StarterSectionSlot
): string {
  return idSchema.parse(`starter-section-${projectId}-${slot}`);
}

export function createStarterScriptSections(
  projectId: string
): ScriptSection[] {
  return STARTER_SECTION_SLOTS.map(({ key, name }) =>
    createScriptSection(starterSectionId(projectId, key), name)
  );
}
