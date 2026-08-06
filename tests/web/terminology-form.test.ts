import { describe, expect, it } from "vitest";

import {
  terminologyFormToCreateInput,
  terminologyFormToUpdateInput
} from "../../src/web/terminology-form.js";

describe("terminology form conversion", () => {
  const form = {
    surface: " SubDub ",
    readingKatakana: "サブダブ",
    category: " system ",
    priority: "-3",
    notes: "メモ"
  };

  it("converts priority input to an integer and applies shared normalization", () => {
    expect(terminologyFormToCreateInput(form)).toEqual({
      surface: "SubDub",
      readingKatakana: "サブダブ",
      category: "system",
      priority: -3,
      notes: "メモ"
    });
  });

  it("uses the complete replacement shape for updates", () => {
    expect(terminologyFormToUpdateInput(form)).toEqual({
      surface: "SubDub",
      readingKatakana: "サブダブ",
      category: "system",
      priority: -3,
      notes: "メモ"
    });
  });
});
