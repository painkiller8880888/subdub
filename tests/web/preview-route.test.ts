import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preview route", () => {
  it("declares /projects/:projectId/preview", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");
    expect(appSource).toContain('path="/projects/:projectId/preview"');
  });

  it("exposes the fixed resolution export control and disables it when playback is unavailable", async () => {
    const pageSource = await fs.readFile("src/web/PreviewPage.tsx", "utf8");
    expect(pageSource).toContain("enqueueProjectPreviewRender");
    expect(pageSource).toContain('id="preview-export-preset"');
    expect(pageSource).toContain("!viewModel.canPlay");
    expect(pageSource).toContain("compileDiagnostics.length > 0");
    expect(pageSource).toContain('compileMutation.data?.status === "failed"');
    expect(pageSource).toContain("保存したプレビューを取得");
  });
});
