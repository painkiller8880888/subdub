import type { ModelSummary } from "../schema/api.js";

export type ModelPricingFilter = "all" | "free" | "paid";
export type ModelPricingTier = Exclude<ModelPricingFilter, "all">;

function isZeroPrice(value: string): boolean {
  const numericValue = Number(value);
  return (
    value.trim().length > 0 &&
    Number.isFinite(numericValue) &&
    numericValue === 0
  );
}

export function modelPricingTier(
  model: Pick<ModelSummary, "inputPrice" | "outputPrice">
): ModelPricingTier {
  return isZeroPrice(model.inputPrice) && isZeroPrice(model.outputPrice)
    ? "free"
    : "paid";
}

export function filterModelsByPricing<
  TModel extends Pick<ModelSummary, "inputPrice" | "outputPrice">
>(models: readonly TModel[], filter: ModelPricingFilter): readonly TModel[] {
  if (filter === "all") {
    return models;
  }

  return models.filter((model) => modelPricingTier(model) === filter);
}
