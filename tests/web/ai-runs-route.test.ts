import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI runs web route", () => {
  it("exposes the global route and project-list discovery link", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");
    expect(appSource).toContain('path="/ai-runs"');
    expect(appSource).toContain('to="/ai-runs"');
  });

  it("contains separate decision counts and the three-state modified label", async () => {
    const pageSource = await fs.readFile("src/web/AiRunsPage.tsx", "utf8");
    expect(pageSource).toContain("採用");
    expect(pageSource).toContain("却下");
    expect(pageSource).toContain("未判断");
    expect(pageSource).toContain("判定不能");
    expect(pageSource).toContain("project revision");
  });
});
