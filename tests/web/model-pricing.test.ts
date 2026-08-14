import { describe, expect, it } from "vitest";

import {
  filterModelsByPricing,
  modelPricingTier
} from "../../src/web/model-pricing.js";

function model(id: string, inputPrice: string, outputPrice: string) {
  return { id, inputPrice, outputPrice };
}

describe("model pricing filter", () => {
  it("treats a model as free only when both prices are zero", () => {
    expect(modelPricingTier(model("free", "0", "0"))).toBe("free");
    expect(modelPricingTier(model("scientific-zero", "0e-8", "0.0"))).toBe(
      "free"
    );
    expect(modelPricingTier(model("input-paid", "0", "0.1"))).toBe("paid");
    expect(modelPricingTier(model("output-paid", "0.1", "0"))).toBe("paid");
  });

  it("filters the model list without changing the all option", () => {
    const models = [model("free", "0", "0"), model("paid", "0.1", "0.2")];

    expect(filterModelsByPricing(models, "all")).toBe(models);
    expect(filterModelsByPricing(models, "free").map(({ id }) => id)).toEqual([
      "free"
    ]);
    expect(filterModelsByPricing(models, "paid").map(({ id }) => id)).toEqual([
      "paid"
    ]);
  });
});
