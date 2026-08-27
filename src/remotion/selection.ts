import type {
  RenderBackground,
  RenderCharacter,
  RenderCharacterVariant,
  RenderLine,
  RenderManifest,
  RenderVisual,
  ResolvedScreenLayoutV26
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

export function selectActiveInsert(
  manifest: RenderManifest,
  frame: number
): RenderManifest["inserts"][number] | undefined {
  return selectActiveItem(manifest.inserts, frame);
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

export function selectActiveScreenLayout(
  manifest: RenderManifest,
  frame: number,
  lines: readonly RenderLine[]
): ResolvedScreenLayoutV26 | undefined {
  const layoutInterval = selectActiveItem(manifest.layoutIntervals, frame);
  if (layoutInterval !== undefined) {
    return layoutInterval.resolvedLayout;
  }
  const line = lines[0];
  if (line !== undefined) {
    return manifest.sectionLayouts.find(
      (layout) => layout.sectionId === line.sectionId
    )?.resolvedLayout;
  }
  const background = selectActiveBackground(manifest, frame);
  return manifest.sectionLayouts.find(
    (layout) => layout.sectionId === background?.sectionId
  )?.resolvedLayout;
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
  variantId: string,
  visualId?: string
): RenderCharacterVariant | undefined {
  return manifest.characterVariants.find(
    (variant) =>
      variant.variantId === variantId &&
      (visualId === undefined || variant.visualId === visualId)
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
  return findCharacterVariant(manifest, variantId, character.visualId);
}

export type CharacterImageSlot = "single" | "closed" | "open";

function validateFrameInputs(character: RenderCharacter, frame: number): void {
  if (!Number.isInteger(frame)) {
    throw new RangeError("Remotion character frame must be an integer");
  }
  if (
    !Number.isInteger(character.lipSyncPeriodFrames) ||
    character.lipSyncPeriodFrames <= 0
  ) {
    throw new RangeError(
      "character lipSyncPeriodFrames must be a positive integer"
    );
  }
}

/**
 * Select the manifest file slot for one character at one frame. Speech uses a
 * half-open interval and starts closed, then alternates at each configured
 * period. The function has no audio, filesystem, time, or random input.
 */
export function selectCharacterImageSlotForFrame(
  manifest: RenderManifest,
  character: RenderCharacter,
  frame: number
): CharacterImageSlot | undefined {
  validateFrameInputs(character, frame);

  const variant = selectCharacterVariantForFrame(manifest, character, frame);
  if (variant === undefined) {
    return undefined;
  }
  if (variant.renderType === "single-image") {
    return "single";
  }

  const activeLine = selectActiveLineForSpeaker(
    manifest,
    character.characterId,
    frame
  );
  if (activeLine === undefined) {
    return "closed";
  }

  const speechFrom = activeLine.from + activeLine.speechFrom;
  const speechEnd = speechFrom + activeLine.speechDurationInFrames;
  if (frame < speechFrom || frame >= speechEnd) {
    return "closed";
  }

  const periodIndex = Math.floor(
    (frame - speechFrom) / character.lipSyncPeriodFrames
  );
  return periodIndex % 2 === 0 ? "closed" : "open";
}

export function selectCharacterImagePathForFrame(
  manifest: RenderManifest,
  character: RenderCharacter,
  frame: number
): string | undefined {
  const variant = selectCharacterVariantForFrame(manifest, character, frame);
  if (variant === undefined) {
    return undefined;
  }

  const slot = selectCharacterImageSlotForFrame(manifest, character, frame);
  if (slot === undefined) {
    return undefined;
  }
  if (variant.renderType === "single-image") {
    return slot === "single" ? variant.files.single.path : undefined;
  }
  return slot === "single" ? undefined : variant.files[slot].path;
}
