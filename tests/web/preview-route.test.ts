import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview route", () => {
  it("declares /projects/:projectId/preview", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");
    expect(appSource).toContain('path="/projects/:projectId/preview"');
  });
});
