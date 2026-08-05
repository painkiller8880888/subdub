import { describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  appendScriptLines,
  createDefaultScriptLine,
  deleteScriptLine,
  duplicateScriptLine,
  moveScriptLine,
  parseBulkScript,
  updateScriptLine,
  validateScriptDraft
} from "../../src/web/script-editor.js";

const project = createEmptyVideoProject({
  projectId: "script-editor-project",
  createdAt: "2026-08-05T00:00:00.000Z"
});

const script = {
  status: "draft" as const,
  origin: "manual" as const,
  outlineHash: "0".repeat(64),
  sections: [
    {
      id: "script-section-main",
      outlineSectionId: "outline-main",
      name: "操作",
      background: { kind: "solid" as const, colorToken: "background" as const },
      lines: [
        createDefaultScriptLine("character-mentor", "line-one", "一つ目"),
        createDefaultScriptLine("character-learner", "line-two", "二つ目")
      ]
    }
  ]
};

describe("script editor helpers", () => {
  it("parses half-width and full-width colons, CRLF, and surrounding whitespace", () => {
    const result = parseBulkScript(
      " 四国めたん： 最初の本文。\r\n\r\nずんだもん: 二つ目の本文。 ",
      project.characters
    );
    expect(result).toEqual({
      ok: true,
      lines: [
        {
          speakerId: "character-mentor",
          spokenText: "最初の本文。",
          subtitleText: "最初の本文。"
        },
        {
          speakerId: "character-learner",
          spokenText: "二つ目の本文。",
          subtitleText: "二つ目の本文。"
        }
      ]
    });
  });

  it("accepts a character ID as the speaker", () => {
    const result = parseBulkScript(
      "character-mentor: 本文",
      project.characters
    );
    expect(result).toMatchObject({
      ok: true,
      lines: [{ speakerId: "character-mentor" }]
    });
  });

  it("rejects every invalid line atomically with line numbers", () => {
    const result = parseBulkScript(
      "四国めたん: 有効\nunknown: 不明\n区切りなし\nずんだもん:   ",
      project.characters
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          lineNumber: 2,
          message: "話者「unknown」が現在のプロジェクトにありません。"
        },
        { lineNumber: 3, message: "話者と本文を分けるコロンがありません。" },
        { lineNumber: 4, message: "本文が空です。" }
      ]
    });
  });

  it("keeps spoken and subtitle text independent", () => {
    const changed = updateScriptLine(script, 0, 0, {
      spokenText: "読み上げ用"
    });
    expect(changed.sections[0]?.lines[0]?.spokenText).toBe("読み上げ用");
    expect(changed.sections[0]?.lines[0]?.subtitleText).toBe("一つ目");
  });

  it("adds, moves, duplicates, and deletes lines without changing section order", () => {
    const added = appendScriptLines(script, 0, [
      createDefaultScriptLine("character-mentor", "line-three", "三つ目")
    ]);
    const moved = moveScriptLine(added, 0, 2, "up");
    const duplicated = duplicateScriptLine(moved, 0, 1);
    const deleted = deleteScriptLine(duplicated, 0, 1);
    expect(added.sections[0]?.lines.map((line) => line.id)).toEqual([
      "line-one",
      "line-two",
      "line-three"
    ]);
    expect(moved.sections[0]?.lines.map((line) => line.id)).toEqual([
      "line-one",
      "line-three",
      "line-two"
    ]);
    expect(duplicated.sections[0]?.lines.map((line) => line.id)).toEqual([
      "line-one",
      "line-three",
      "line-three-copy",
      "line-two"
    ]);
    expect(deleted.sections[0]?.lines.map((line) => line.id)).toEqual([
      "line-one",
      "line-three-copy",
      "line-two"
    ]);
  });

  it("reports field-level draft validation without discarding the draft", () => {
    const invalid = updateScriptLine(script, 0, 0, {
      speakerId: "missing-character",
      spokenText: " ",
      subtitleText: " ",
      pauseBeforeMs: -1
    });
    const issues = validateScriptDraft(invalid, project.characters);
    expect(issues.map((issue) => issue.path.at(-1))).toEqual(
      expect.arrayContaining([
        "speakerId",
        "spokenText",
        "subtitleText",
        "pauseBeforeMs"
      ])
    );
    expect(invalid.sections[0]?.lines[0]?.spokenText).toBe(" ");
  });
});
