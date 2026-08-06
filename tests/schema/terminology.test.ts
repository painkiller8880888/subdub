import { describe, expect, it } from "vitest";

import { terminologyCreateRequestSchema } from "../../src/schema/api.js";
import {
  isTerminologyReadingKatakana,
  normalizeTerminologySurface,
  terminologyReadingInputSchema
} from "../../src/schema/terminology.js";

describe("terminology schemas and normalization", () => {
  it("normalizes surfaces to NFC and removes surrounding whitespace", () => {
    const parsed = terminologyCreateRequestSchema.parse({
      surface: "  e\u0301xample  ",
      readingKatakana: "システム",
      category: " system ",
      priority: -2
    });

    expect(parsed.surface).toBe("éxample");
    expect(parsed.category).toBe("system");
    expect(parsed.priority).toBe(-2);
    expect(parsed.notes).toBe("");
    expect(normalizeTerminologySurface("e\u0301xample")).toBe(
      normalizeTerminologySurface("éxample")
    );
  });

  it("rejects unknown fields and empty normalized surfaces", () => {
    expect(
      terminologyCreateRequestSchema.safeParse({
        surface: "term",
        readingKatakana: "ターム",
        category: "other",
        unknown: true
      }).success
    ).toBe(false);
    expect(
      terminologyCreateRequestSchema.safeParse({
        surface: " \t ",
        readingKatakana: "ターム",
        category: "other"
      }).success
    ).toBe(false);
  });

  it("allows the supported full-width katakana reading characters", () => {
    for (const reading of [
      "システム",
      "ユーザー・アイディー",
      "トウキョウ　ホンシャ",
      "ミュージック・サーバー ヽヾ"
    ]) {
      expect(isTerminologyReadingKatakana(reading)).toBe(true);
      expect(terminologyReadingInputSchema.parse(reading)).toBe(reading);
    }
  });

  it("rejects empty, hiragana, half-width, latin, numeric, and multiline readings", () => {
    for (const reading of [
      "",
      "しすてむ",
      "ｼｽﾃﾑ",
      "System",
      "123",
      "システム\nテスト",
      "システム\tテスト"
    ]) {
      expect(terminologyReadingInputSchema.safeParse(reading).success).toBe(
        false
      );
    }
  });

  it("rejects blank categories and fractional priorities", () => {
    expect(
      terminologyCreateRequestSchema.safeParse({
        surface: "term",
        readingKatakana: "ターム",
        category: "   "
      }).success
    ).toBe(false);
    expect(
      terminologyCreateRequestSchema.safeParse({
        surface: "term",
        readingKatakana: "ターム",
        category: "other",
        priority: 1.5
      }).success
    ).toBe(false);
  });
});
