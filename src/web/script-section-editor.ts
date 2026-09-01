import type { Script, ScriptSection } from "../schema/video-project.js";
import { cloneScript } from "./script-editor.js";

export type ScriptSectionMoveDirection = "up" | "down";

/**
 * The server replaces this request-only identity with the persisted section
 * ID. It must never be shown or reused as a project reference.
 */
function pendingSectionId(): string {
  return `pending-script-section-${globalThis.crypto.randomUUID()}`;
}

export function createPendingScriptSection(
  script: Script,
  name: string
): Script {
  const next = cloneScript(script);
  const requestTemplate = next.sections[0];
  if (requestTemplate === undefined) {
    throw new Error("A project must have at least one script section.");
  }
  // PUT /script requires a complete Script shape, but the server replaces an
  // unknown section ID with its canonical defaults. Reuse the existing shape
  // only as a request placeholder; it is never rendered or persisted by the
  // client as the new section's final configuration.
  next.sections.push({
    ...requestTemplate,
    id: pendingSectionId(),
    name,
    enabled: true,
    lines: []
  });
  return next;
}

export function updateScriptSectionLifecycle(
  script: Script,
  sectionId: string,
  update: Partial<Pick<ScriptSection, "name" | "enabled">>
): Script {
  const next = cloneScript(script);
  const section = next.sections.find((candidate) => candidate.id === sectionId);
  if (section !== undefined) {
    Object.assign(section, update);
  }
  return next;
}

export function moveScriptSection(
  script: Script,
  sectionId: string,
  direction: ScriptSectionMoveDirection
): Script {
  const next = cloneScript(script);
  const currentIndex = next.sections.findIndex(
    (section) => section.id === sectionId
  );
  if (currentIndex < 0) {
    return next;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= next.sections.length) {
    return next;
  }

  const current = next.sections[currentIndex];
  const target = next.sections[targetIndex];
  if (current === undefined || target === undefined) {
    return next;
  }
  next.sections[currentIndex] = target;
  next.sections[targetIndex] = current;
  return next;
}
