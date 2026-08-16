import type {
  RenderAudioTrack,
  RenderLine,
  RenderSoundEffect
} from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  resolveManifestAssetUrl,
  type ManifestAssetUrlResolver
} from "./asset-url";

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Resolve the fixed BGM volume for a frame in its manifest Sequence. */
export function audioTrackVolumeAtFrame(
  track: RenderAudioTrack,
  frame: number
): number {
  void frame;
  return clampUnit(track.volume);
}

export function audioTrackSequenceProps(
  track: RenderAudioTrack,
  assetUrlResolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly loop: boolean;
} {
  return {
    from: track.from,
    durationInFrames: track.durationInFrames,
    src: resolveManifestAssetUrl(track.src, assetUrlResolver),
    loop: track.loop
  };
}

export function soundEffectSequenceProps(
  effect: RenderSoundEffect,
  assetUrlResolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly volume: number;
} {
  return {
    from: effect.from,
    durationInFrames: effect.durationInFrames,
    src: resolveManifestAssetUrl(effect.src, assetUrlResolver),
    volume: effect.volume
  };
}

export function speechSequenceProps(
  line: RenderLine,
  assetUrlResolver: ManifestAssetUrlResolver = defaultManifestAssetUrlResolver
): {
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
} {
  return {
    from: line.from + line.speechFrom,
    durationInFrames: line.speechDurationInFrames,
    src: resolveManifestAssetUrl(line.audioPath, assetUrlResolver)
  };
}
