import { describe, expect, it } from "vitest";

import { sameBriefDraft, type BriefDraft } from "../../src/web/brief-draft.js";

const baseDraft: BriefDraft = {
  markdown: "initial markdown",
  audience: "audience",
  postViewingGoal: "goal",
  prerequisites: ["prerequisite"],
  targetDurationSec: "60",
  requiredItems: ["required"],
  prohibitedItems: ["prohibited"],
  globalDirectives: ["directive"]
};

describe("brief draft comparison", () => {
  it("ignores Markdown when comparing project brief fields", () => {
    expect(
      sameBriefDraft(baseDraft, {
        ...baseDraft,
        markdown: "updated markdown"
      })
    ).toBe(true);
  });

  it("detects changes to a project brief field", () => {
    expect(
      sameBriefDraft(baseDraft, {
        ...baseDraft,
        audience: "updated audience"
      })
    ).toBe(false);
  });
});
