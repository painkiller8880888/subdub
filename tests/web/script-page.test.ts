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

  it("keeps line cards compact and expands text only while editing", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source).toContain('className="script-line-primary-row"');
    expect(source).toContain('className="script-line-action-row"');
    expect(source).toContain("rows={expanded ? 4 : 1}");
    expect(source).toContain("onFocus={() => setExpandedTextField(field)}");
    expect(source).toContain("現在の音声");
    expect(source).toContain("再生成");
    expect(source).toContain("詳細設定（表情・発話前後の間）");
    expect(source).not.toContain('className="script-line-fields"');
  });

  it("uses a modal boundary for detailed voice adjustment", async () => {
    const source = await fs.readFile(
      "src/web/VoiceAdjustmentEditor.tsx",
      "utf8"
    );

    expect(source).toContain('className="voice-adjustment-backdrop"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain("previouslyFocused?.focus()");
  });
});
