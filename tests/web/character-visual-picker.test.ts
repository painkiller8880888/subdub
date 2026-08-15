import { describe, expect, it } from "vitest";

import type { CharacterVariant } from "../../src/schema/character-visual.js";
import { sortCharacterVariantsForTags } from "../../src/web/character-visual-picker.js";

function variant(variantId: string, tags: string[]): CharacterVariant {
  return { variantId, tags } as CharacterVariant;
}

describe("character visual picker ordering", () => {
  it("sorts by matching tag count without filtering candidates", () => {
    const variants = [
      variant("neutral", ["calm"]),
      variant("pointing", ["calm", "gesture"]),
      variant("smile", ["emotion"])
    ];

    expect(
      sortCharacterVariantsForTags(variants, ["calm", "gesture"]).map(
        (candidate) => candidate.variantId
      )
    ).toEqual(["pointing", "neutral", "smile"]);
    expect(
      sortCharacterVariantsForTags(variants, ["missing"]).map(
        (candidate) => candidate.variantId
      )
    ).toEqual(["neutral", "pointing", "smile"]);
  });
});
