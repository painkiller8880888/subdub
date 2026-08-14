import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

describe("character visual management route", () => {
  it("exposes the workspace route and keeps registration outside projects", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");
    const pageSource = await fs.readFile(
      "src/web/CharacterVisualsPage.tsx",
      "utf8"
    );

    expect(appSource).toContain('path="/character-visuals"');
    expect(pageSource).toContain("fetchCharacterVisualCatalog");
    expect(pageSource).toContain("createCharacterVisual");
    expect(pageSource).toContain("createCharacterVisualVariant");
    expect(pageSource).toContain("mouth-pair");
    expect(pageSource).toContain("closed（口閉じ）");
    expect(pageSource).toContain("open（口開き）");
    expect(pageSource).not.toContain("neutral 必須");
  });

  it("keeps the existing project workflow route declarations", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");

    expect(appSource).toContain('path="/projects/:projectId/script"');
    expect(appSource).toContain('path="/projects/:projectId/characters"');
    expect(appSource).toContain('path="/terminology"');
    expect(appSource).toContain('path="/ai-runs"');
  });
});
