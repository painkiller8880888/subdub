import type { RenderManifest } from "../schema/index";

const EMPTY_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export const defaultRenderManifest: RenderManifest = {
  manifestVersion: "2.9.0",
  sourceProjectHash: EMPTY_HASH,
  compilerInputHash: EMPTY_HASH,
  characterCatalogVersion: "default",
  characterMappingVersion: "default",
  characters: [],
  characterVariants: [],
  sourceAssetChecksums: [],
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 120,
  sectionLayouts: [],
  layoutIntervals: [],
  lines: [],
  visuals: [],
  backgrounds: [],
  audioTracks: [],
  soundEffects: [],
  inserts: [],
  lineOverlays: []
};
