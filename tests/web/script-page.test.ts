import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

describe("ScriptPage workflow navigation", () => {
  it("flushes autosave before every workflow link and uses the 台本 stage name", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source.match(/<WorkflowIndicator/g)).toHaveLength(2);
    expect(
      source.match(/onNavigate=\{\(event, destination\) =>/g)
    ).toHaveLength(2);
    expect(
      source.match(/void navigateAway\(event, destination\)/g)
    ).toHaveLength(2);
    expect(source.match(/<p className="eyebrow">台本<\/p>/g)).toHaveLength(2);
    expect(source).not.toContain("制作 台本・ビジュアル・音声");
  });
});
