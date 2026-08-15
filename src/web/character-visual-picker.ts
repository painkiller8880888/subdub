import type { CharacterVariant } from "../schema/character-visual.js";

export function sortCharacterVariantsForTags(
  variants: readonly CharacterVariant[],
  selectedTags: readonly string[]
): CharacterVariant[] {
  const tags = new Set(selectedTags);
  return variants
    .map((variant, index) => ({
      variant,
      index,
      matchCount: variant.tags.reduce(
        (count, tag) => count + (tags.has(tag) ? 1 : 0),
        0
      )
    }))
    .sort(
      (left, right) =>
        right.matchCount - left.matchCount || left.index - right.index
    )
    .map(({ variant }) => variant);
}

export function characterVisualFileUrl(
  visualId: string,
  variantId: string,
  fileKey: string
): string {
  return `/api/character-visuals/${encodeURIComponent(visualId)}/${encodeURIComponent(variantId)}/${encodeURIComponent(fileKey)}`;
}
