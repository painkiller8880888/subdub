import { idSchema, type ScriptSection } from "../../schema/index.js";
import { STANDARD_SCREEN_TEMPLATE_ID } from "../screen-templates/screen-template-seed.js";

export const STARTER_SECTION_SLOTS = [
  { key: "intro", name: "導入" },
  { key: "main", name: "本編" },
  { key: "outro", name: "締め" }
] as const;

export type StarterSectionSlot = (typeof STARTER_SECTION_SLOTS)[number]["key"];

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
  return STARTER_SECTION_SLOTS.map(({ key, name }) => ({
    id: starterSectionId(projectId, key),
    name,
    enabled: true,
    background: { kind: "solid", colorToken: "background" },
    screenTemplateId: STANDARD_SCREEN_TEMPLATE_ID,
    lines: []
  }));
}
