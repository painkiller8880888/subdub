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
    expect(pageSource).toContain("更新番号");
  });

  it("offers a JSON Lines export from the applied query with safe download handling", async () => {
    const pageSource = await fs.readFile("src/web/AiRunsPage.tsx", "utf8");
    expect(pageSource).toContain("検索結果をJSON Lines形式で出力");
    expect(pageSource).toContain("buildAiRunExportQuery(searchQuery)");
    expect(pageSource).toContain("disabled={isExporting}");
    expect(pageSource).toContain("URL.createObjectURL(blob)");
    expect(pageSource).toContain("URL.revokeObjectURL(objectUrl)");
    expect(pageSource).toContain("出力中…");
    expect(pageSource).toContain("AI実行ログのエクスポートに失敗しました。");
  });
});
