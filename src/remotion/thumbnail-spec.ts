import type { ThumbnailPlan } from "../schema/index.js";

export const STANDARD_THUMBNAIL_COMPOSITION_ID =
  "StandardThumbnailComposition" as const;
export const STANDARD_THUMBNAIL_WIDTH = 1280 as const;
export const STANDARD_THUMBNAIL_HEIGHT = 720 as const;
export const STANDARD_THUMBNAIL_FPS = 30 as const;
export const STANDARD_THUMBNAIL_DURATION_IN_FRAMES = 1 as const;

export type StandardThumbnailCompositionInput = Readonly<{
  thumbnail: ThumbnailPlan;
  characterImagePath: string | null;
}>;

export const defaultStandardThumbnailCompositionInput = {
  thumbnail: {
    backgroundImage: null,
    title: "社内マニュアル",
    subtitle: null,
    departmentOrSystem: "業務システム",
    manualVersion: null,
    characterId: null,
    representativeVisualPath: null,
    layout: "standard"
  },
  characterImagePath: null
} satisfies StandardThumbnailCompositionInput;
