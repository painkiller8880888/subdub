import type { RenderAudioTrack, RenderSoundEffect } from "../schema/index";
import { resolveManifestAssetUrl } from "./asset-url";

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Resolve the volume for a BGM frame relative to its manifest Sequence.
 * Multiplying both fade factors keeps overlapping fades within 0..volume.
 */
export function audioTrackVolumeAtFrame(
  track: RenderAudioTrack,
  frame: number
): number {
  const fadeInFactor =
    track.fadeInFrames === 0 ? 1 : clampUnit(frame / track.fadeInFrames);
  const fadeOutFactor =
    track.fadeOutFrames === 0
      ? 1
      : clampUnit((track.durationInFrames - frame) / track.fadeOutFrames);
  return Math.min(
    track.volume,
    Math.max(0, track.volume * fadeInFactor * fadeOutFactor)
  );
}

export function audioTrackSequenceProps(track: RenderAudioTrack): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly loop: boolean;
} {
  return {
    from: track.from,
    durationInFrames: track.durationInFrames,
    src: resolveManifestAssetUrl(track.src),
    loop: track.loop
  };
}

export function soundEffectSequenceProps(effect: RenderSoundEffect): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly volume: number;
} {
  return {
    from: effect.from,
    durationInFrames: effect.durationInFrames,
    src: resolveManifestAssetUrl(effect.src),
    volume: effect.volume
  };
}
