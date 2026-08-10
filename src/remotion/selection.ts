import type {
  RenderBackground,
  RenderCharacter,
  RenderCharacterVariant,
  RenderLine,
  RenderManifest,
  RenderVisual
} from "../schema/index";

export type TimelineInterval = Readonly<{
  from: number;
  durationInFrames: number;
}>;

/**
 * RenderManifest intervals are half-open: the first frame is included and the
 * frame at `from + durationInFrames` is not.
 */
export function isFrameInInterval(
  frame: number,
  interval: TimelineInterval
): boolean {
  return (
    frame >= interval.from && frame < interval.from + interval.durationInFrames
  );
}

export function selectActiveItem<T extends TimelineInterval>(
  items: readonly T[],
  frame: number
): T | undefined {
  return items.find((item) => isFrameInInterval(frame, item));
}

export function selectActiveBackground(
  manifest: RenderManifest,
  frame: number
): RenderBackground | undefined {
  return selectActiveItem(manifest.backgrounds, frame);
}

export function selectActiveVisuals(
  manifest: RenderManifest,
  frame: number
): RenderVisual[] {
  return manifest.visuals.filter((visual) => isFrameInInterval(frame, visual));
}

export function selectActiveLines(
  manifest: RenderManifest,
  frame: number
): RenderLine[] {
  return manifest.lines.filter((line) => isFrameInInterval(frame, line));
}

export function selectActiveLineForSpeaker(
  manifest: RenderManifest,
  speakerId: string,
  frame: number
): RenderLine | undefined {
  return selectActiveLines(manifest, frame).find(
    (line) => line.speakerId === speakerId
  );
}

export function findCharacterVariant(
  manifest: RenderManifest,
  variantId: string
): RenderCharacterVariant | undefined {
  return manifest.characterVariants.find(
    (variant) => variant.variantId === variantId
  );
}

export function selectCharacterVariantForFrame(
  manifest: RenderManifest,
  character: RenderCharacter,
  frame: number
): RenderCharacterVariant | undefined {
  const activeLine = selectActiveLineForSpeaker(
    manifest,
    character.characterId,
    frame
  );
  const variantId = activeLine?.characterVariantId ?? character.idleVariantId;
  return findCharacterVariant(manifest, variantId);
}
