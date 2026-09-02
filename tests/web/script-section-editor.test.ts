import { describe, expect, it } from "vitest";

import { createScriptSection } from "../../src/app/projects/starter-script-sections.js";
import type { Script } from "../../src/schema/video-project.js";
import {
  createPendingScriptSection,
  moveScriptSection,
  updateScriptSectionLifecycle
} from "../../src/web/script-section-editor.js";

function script(): Script {
  return {
    sections: [
      createScriptSection("section-intro", "導入"),
      createScriptSection("section-main", "本編"),
      createScriptSection("section-outro", "締め")
    ]
  };
}

describe("script section editor", () => {
  it("updates lifecycle fields without changing the section identity", () => {
    const current = script();
    const renamed = updateScriptSectionLifecycle(current, "section-main", {
      name: "手順"
    });
    const disabled = updateScriptSectionLifecycle(renamed, "section-main", {
      enabled: false
    });

    expect(current.sections[1]?.name).toBe("本編");
    expect(disabled.sections[1]).toMatchObject({
      id: "section-main",
      name: "手順",
      enabled: false
    });
  });

  it("reorders the collection while preserving stable IDs", () => {
    const moved = moveScriptSection(script(), "section-main", "up");

    expect(moved.sections.map((section) => section.id)).toEqual([
      "section-main",
      "section-intro",
      "section-outro"
    ]);
  });

  it("moves across disabled sections by enabled display order", () => {
    const current = script();
    current.sections[1]!.enabled = false;

    const movedUp = moveScriptSection(current, "section-outro", "up");
    const movedDown = moveScriptSection(current, "section-intro", "down");

    expect(movedUp.sections.map((section) => section.id)).toEqual([
      "section-outro",
      "section-main",
      "section-intro"
    ]);
    expect(movedUp.sections[1]?.enabled).toBe(false);
    expect(movedDown.sections.map((section) => section.id)).toEqual([
      "section-outro",
      "section-main",
      "section-intro"
    ]);
  });

  it("creates a request-only section for server-side defaulting", () => {
    const current = script();
    const added = createPendingScriptSection(current, "補足");
    const section = added.sections.at(-1);

    expect(section).toMatchObject({
      name: "補足",
      enabled: true,
      background: current.sections[0]?.background,
      screenTemplateId: current.sections[0]?.screenTemplateId,
      lines: []
    });
    expect(section?.id).toMatch(/^pending-script-section-/u);
  });
});
