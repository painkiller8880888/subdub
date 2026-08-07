import type { AssetKind } from "../../../schema/asset.js";

export type AssetMediaAnalysis = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
};

export type AssetProcessedMedia = {
  metadata: AssetMediaAnalysis;
  /** Thumbnail PNG images in display order (PDF: page order; video/photo: one frame). */
  thumbnails: readonly Buffer[];
};

export type AssetMediaProcessingInput = {
  /** Absolute path of the media file. Never persisted or exposed. */
  mediaPath: string;
  kind: AssetKind;
  maxThumbnailEdgePx: number;
};

export type AssetMediaProcessingPort = {
  processMedia(input: AssetMediaProcessingInput): Promise<AssetProcessedMedia>;
};
