import type { ReactNode } from "react";

import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";

import type { RenderManifest } from "../schema/index";
import {
  defaultManifestAssetUrlResolver,
  type ManifestAssetUrlResolver
} from "./asset-url";
import { ManifestAudioLayer } from "./audio-layer";
import { BackgroundVisual } from "./background";
import { CharacterLayer } from "./characters";
import { DocumentVisual } from "./document-visual";
import { REMOTION_FONT_FAMILY, RemotionFontLoader } from "./font";
import { DESIGN_COLORS } from "./layout";
import {
  selectActiveBackground,
  selectActiveInsert,
  selectActiveLines,
  selectActiveVisuals,
  selectActiveScreenLayout
} from "./selection";
import { SectionTitleLayer } from "./section-title";
import { SubtitleLayer } from "./subtitle";
import { VideoInsert } from "./video-insert";
import { PhotoVisual, VideoVisual } from "./visuals";

function RenderVisual({
  manifest,
  visual,
  assetUrlResolver
}: {
  manifest: RenderManifest;
  visual: RenderManifest["visuals"][number];
  assetUrlResolver: ManifestAssetUrlResolver;
}): ReactNode {
  if (visual.kind === "video") {
    return (
      <VideoVisual
        visual={visual}
        fps={manifest.fps}
        assetUrlResolver={assetUrlResolver}
      />
    );
  }
  if (visual.kind === "photo") {
    return <PhotoVisual visual={visual} assetUrlResolver={assetUrlResolver} />;
  }
  return <DocumentVisual visual={visual} assetUrlResolver={assetUrlResolver} />;
}

export type RenderManifestCompositionInput =
  | RenderManifest
  | {
      readonly manifest: RenderManifest;
      readonly assetUrlResolver?: ManifestAssetUrlResolver;
    };

function isCompositionInput(
  input: RenderManifestCompositionInput
): input is Extract<
  RenderManifestCompositionInput,
  { manifest: RenderManifest }
> {
  return "manifest" in input;
}

export function renderManifestFromInput(
  input: RenderManifestCompositionInput
): RenderManifest {
  return isCompositionInput(input) ? input.manifest : input;
}

function assetResolverFromInput(
  input: RenderManifestCompositionInput
): ManifestAssetUrlResolver {
  return isCompositionInput(input)
    ? (input.assetUrlResolver ?? defaultManifestAssetUrlResolver)
    : defaultManifestAssetUrlResolver;
}

export function RenderManifestComposition(
  input: RenderManifestCompositionInput
): ReactNode {
  const manifest = renderManifestFromInput(input);
  const assetUrlResolver = assetResolverFromInput(input);
  const frame = useCurrentFrame();
  const activeInsert = selectActiveInsert(manifest, frame);
  if (activeInsert !== undefined) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: DESIGN_COLORS.background,
          overflow: "hidden",
          fontFamily: REMOTION_FONT_FAMILY
        }}
      >
        <RemotionFontLoader />
        <Sequence
          from={activeInsert.from}
          durationInFrames={activeInsert.durationInFrames}
          layout="none"
          name={`insert:${activeInsert.id}`}
        >
          <VideoInsert
            insert={activeInsert}
            assetUrlResolver={assetUrlResolver}
          />
        </Sequence>
      </AbsoluteFill>
    );
  }

  const background = selectActiveBackground(manifest, frame);
  const activeVisuals = selectActiveVisuals(manifest, frame);
  const activeLines = selectActiveLines(manifest, frame);
  const activeLayout = selectActiveScreenLayout(manifest, frame, activeLines);
  const activeSectionId = activeLines[0]?.sectionId ?? background?.sectionId;
  const sectionTitle = manifest.sectionLayouts.find(
    (layout) => layout.sectionId === activeSectionId
  )?.sectionTitle;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: DESIGN_COLORS.background,
        overflow: "hidden",
        fontFamily: REMOTION_FONT_FAMILY
      }}
    >
      <RemotionFontLoader />
      <ManifestAudioLayer
        manifest={manifest}
        assetUrlResolver={assetUrlResolver}
      />
      <BackgroundVisual
        background={background?.background}
        assetUrlResolver={assetUrlResolver}
      />
      {activeVisuals.map((visual) => (
        <Sequence
          key={visual.id}
          from={visual.from}
          durationInFrames={visual.durationInFrames}
          layout="none"
          name={visual.id}
        >
          <RenderVisual
            manifest={manifest}
            visual={visual}
            assetUrlResolver={assetUrlResolver}
          />
        </Sequence>
      ))}
      <CharacterLayer
        manifest={manifest}
        frame={frame}
        layout={activeLayout}
        assetUrlResolver={assetUrlResolver}
      />
      <SectionTitleLayer layout={activeLayout} title={sectionTitle} />
      <SubtitleLayer
        manifest={manifest}
        lines={activeLines}
        layout={activeLayout}
      />
    </AbsoluteFill>
  );
}
