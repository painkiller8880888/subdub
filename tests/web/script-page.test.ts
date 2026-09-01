import { promises as fs } from "node:fs";

import { describe, expect, it } from "vitest";

describe("ScriptPage workflow navigation", () => {
  it("flushes autosave before every workflow link and uses the 台本 stage name", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source.match(/<WorkflowIndicator/g)).toHaveLength(1);
    expect(
      source.match(/onNavigate=\{\(event, destination\) =>/g)
    ).toHaveLength(1);
    expect(
      source.match(/void navigateAway\(event, destination\)/g)
    ).toHaveLength(1);
    expect(source.match(/<p className="eyebrow">台本<\/p>/g)).toHaveLength(1);
    expect(source).not.toContain("制作 台本・ビジュアル・音声");
  });

  it("adopts the server project only once per project", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source).toContain("initializedForProjectRef.current === projectId");
    expect(source).toContain("initializedForProjectRef.current = null;");
  });

  it("exposes section lifecycle actions and keeps the server response authoritative", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source).toContain("createPendingScriptSection");
    expect(source).toContain("moveScriptSection");
    expect(source).toContain("updateScriptSectionLifecycle");
    expect(source).toContain("expectedRevision: currentProject.revision");
    expect(source).toContain("無効なセクション (");
    expect(source).toContain("再有効化");
    expect(source).toContain("セクションを追加");
    expect(source).not.toContain("セクションを削除");
  });

  it("places the section line-add action after the section lines", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");
    const sectionHeaderStart = source.indexOf(
      'className="script-section-header"'
    );
    const sectionHeaderEnd = source.indexOf("</header>", sectionHeaderStart);
    const lineListStart = source.indexOf('className="script-line-list"');
    const addLineButtonStart = source.indexOf(
      'className="button script-section-add-line"'
    );

    expect(sectionHeaderStart).toBeGreaterThanOrEqual(0);
    expect(sectionHeaderEnd).toBeGreaterThan(sectionHeaderStart);
    expect(lineListStart).toBeGreaterThan(sectionHeaderEnd);
    expect(addLineButtonStart).toBeGreaterThan(lineListStart);
  });

  it("shrinks UI font declarations while preserving the compact label size", async () => {
    const styles = await fs.readFile("src/web/styles.css", "utf8");

    expect(styles).toContain("--ui-font-size-minimum: 0.82rem;");
    expect(styles).toContain(
      "font-size: max(calc(1rem - 2px), var(--ui-font-size-minimum));"
    );
    expect(styles).toContain(
      "font-size: max(calc(0.82rem - 2px), var(--ui-font-size-minimum));"
    );
    expect(styles).not.toMatch(/font-size:\s*\d+(?:\.\d+)?rem\s*;/);
  });

  it("keeps line cards compact and expands text only while editing", async () => {
    const source = await fs.readFile("src/web/ScriptPage.tsx", "utf8");

    expect(source).toContain('className="script-line-primary-row"');
    expect(source).toContain('className="script-line-primary-controls"');
    expect(source).toContain('className="script-line-action-row"');
    expect(source).toContain("rows={expanded ? 4 : 1}");
    expect(source).toContain("onFocus={() => setExpandedTextField(field)}");
    expect(source).toContain("音声を再生");
    expect(source).toContain("voiceStatusLoading");
    expect(source).toContain('state: "missing"');
    expect(source).toContain('state: "unavailable"');
    expect(source.indexOf("if (status !== undefined)")).toBeLessThan(
      source.indexOf("if (!available)")
    );
    expect(source).toContain("aria-label={voiceIndicator.accessibleLabel}");
    expect(source).toContain('className="script-line-details-dialog"');
    expect(source).toContain("再生成");
    expect(source).toContain(">詳細設定</");
    expect(source).not.toMatch(/<audio[^>]*\bcontrols(?:\s|=|>)/);
    expect(source).not.toContain("candidate.role");
    expect(source).not.toContain("CharacterVariantPreview");
    expect(source).not.toContain(
      'className="script-line-card-character-preview"'
    );
    expect(source).toContain("aria-label={`${line.id}の話者`}");
    expect(source).toContain('textRow("spoken", "読み上げ"');
    expect(source).not.toContain("読み上げ（VOICEVOX）");
    expect(source).not.toContain("variantSummary");
    expect(source).not.toContain('className="script-line-fields"');
  });

  it("gives the removed character preview space to the screen preview", async () => {
    const styles = (await fs.readFile("src/web/styles.css", "utf8")).replaceAll(
      "\r\n",
      "\n"
    );

    expect(styles).toContain(
      "grid-template-columns: minmax(22rem, 0.8fr) minmax(0, 1fr) minmax(16rem, 0.32fr);"
    );
    expect(styles).toContain(
      ".script-line-audio-control {\n  flex: 0 0 auto;\n  justify-content: flex-start;\n}"
    );
  });

  it("connects the line media pane to shared visual assignment actions", async () => {
    const [pageSource, paneSource] = await Promise.all([
      fs.readFile("src/web/ScriptPage.tsx", "utf8"),
      fs.readFile("src/web/ScriptMediaPane.tsx", "utf8")
    ]);

    expect(pageSource).toContain("<ScriptMediaPane");
    expect(pageSource).toContain("resolveScriptLinePreviewStates");
    expect(pageSource).toContain("expectedRevision: currentProject.revision");
    expect(pageSource).toContain("removePlaybackCuesOutsideRange");
    expect(pageSource).toContain("mediaKindChangeConfirmation");
    expect(pageSource).toContain("ScriptMediaDialog");
    expect(paneSource).toContain("素材を挿入");
    expect(paneSource).toContain("一時停止");
    expect(paneSource).toContain("再開");
    expect(paneSource).toContain('lifecycle === "ended"');
    expect(paneSource).toContain("停止");
    expect(paneSource).toContain("変更");
    expect(paneSource).toContain("この行から変更");
    expect(pageSource).toContain("splitProjectVisualAssignment");
    expect(pageSource).toContain("mediaSplitConfirmation");
    expect(paneSource).not.toContain("素材を表示 / 再生開始");
    expect(paneSource).not.toContain("script-media-details");
    expect(paneSource).not.toContain("script-media-conflict-message");
    expect(paneSource).toContain("boundaryCueDisabled");
    expect(paneSource).toContain("次のセリフ以降で指定してください");
    expect(paneSource).toContain("mediaDialogFocusableSelector");
    expect(paneSource).toContain("OS pathは入力できません");
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
