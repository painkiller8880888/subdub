import type { CharacterVisualSet } from "../schema/character-visual.js";

export type CharacterVisualDraft = Pick<
  CharacterVisualSet,
  "name" | "description" | "status"
>;

export function createEmptyCharacterVisualDraft(): CharacterVisualDraft {
  return {
    name: "",
    description: "",
    status: "active"
  };
}

export function characterVisualDraftFromSet(
  visual: CharacterVisualSet
): CharacterVisualDraft {
  return {
    name: visual.name,
    description: visual.description,
    status: visual.status
  };
}

export function characterVisualFileUrl(
  visualId: string,
  variantId: string,
  fileKey: string,
  checksum?: string
): string {
  const path = `/api/character-visuals/${encodeURIComponent(visualId)}/${encodeURIComponent(variantId)}/${encodeURIComponent(fileKey)}`;
  return checksum === undefined
    ? path
    : `${path}?v=${encodeURIComponent(checksum)}`;
}

export function shouldInitializeSelectedVisualDraft(
  initializedVisualId: string | null,
  selectedVisualId: string | null,
  selectedVisual: CharacterVisualSet | undefined
): boolean {
  return (
    selectedVisualId !== null &&
    selectedVisual !== undefined &&
    selectedVisual.visualId === selectedVisualId &&
    initializedVisualId !== selectedVisualId
  );
}

export function isCharacterVisualMutationForSelectedVisual(
  mutationVisualId: string | undefined,
  selectedVisualId: string | null
): boolean {
  return selectedVisualId !== null && mutationVisualId === selectedVisualId;
}
