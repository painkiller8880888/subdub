import type { RenderManifest } from "../schema/index";

const EMPTY_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export const defaultRenderManifest: RenderManifest = {
  manifestVersion: "2.2.0",
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
  lines: [],
  visuals: [],
  backgrounds: [],
  audioTracks: [],
  soundEffects: [],
  inserts: [
    {
      id: "default-opening",
      kind: "placeholder",
      slot: "opening",
      beforeSectionId: null,
      from: 0,
      durationInFrames: 60,
      label: "opening"
    },
    {
      id: "default-ending",
      kind: "placeholder",
      slot: "ending",
      beforeSectionId: null,
      from: 60,
      durationInFrames: 60,
      label: "ending"
    }
  ]
};
