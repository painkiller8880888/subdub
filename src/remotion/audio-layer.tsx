import type { ReactNode } from "react";

import { Audio, Sequence } from "remotion";

import type {
  RenderAudioTrack,
  RenderManifest,
  RenderSoundEffect
} from "../schema/index";
import {
  audioTrackSequenceProps,
  audioTrackVolumeAtFrame,
  soundEffectSequenceProps
} from "./audio";
import {
  defaultManifestAssetUrlResolver,
  type ManifestAssetUrlResolver
} from "./asset-url";

function AudioTrackSequence({
  track,
  assetUrlResolver
}: {
  track: RenderAudioTrack;
  assetUrlResolver: ManifestAssetUrlResolver;
}): ReactNode {
  const sequence = audioTrackSequenceProps(track, assetUrlResolver);
  return (
    <Sequence
      from={sequence.from}
      durationInFrames={sequence.durationInFrames}
      layout="none"
      name={`bgm:${track.id}`}
    >
      <Audio
        src={sequence.src}
        loop={sequence.loop}
        volume={(frame) => audioTrackVolumeAtFrame(track, frame)}
      />
    </Sequence>
  );
}

function SoundEffectSequence({
  effect,
  assetUrlResolver
}: {
  effect: RenderSoundEffect;
  assetUrlResolver: ManifestAssetUrlResolver;
}): ReactNode {
  const sequence = soundEffectSequenceProps(effect, assetUrlResolver);
  return (
    <Sequence
      from={sequence.from}
      durationInFrames={sequence.durationInFrames}
      layout="none"
      name={`sfx:${effect.id}`}
    >
      <Audio src={sequence.src} volume={sequence.volume} />
    </Sequence>
  );
}

export function ManifestAudioLayer({
  manifest,
  assetUrlResolver = defaultManifestAssetUrlResolver
}: {
  manifest: RenderManifest;
  assetUrlResolver?: ManifestAssetUrlResolver;
}): ReactNode {
  return (
    <>
      {manifest.audioTracks.map((track) => (
        <AudioTrackSequence
          key={track.id}
          track={track}
          assetUrlResolver={assetUrlResolver}
        />
      ))}
      {manifest.soundEffects.map((effect) => (
        <SoundEffectSequence
          key={effect.id}
          effect={effect}
          assetUrlResolver={assetUrlResolver}
        />
      ))}
    </>
  );
}
