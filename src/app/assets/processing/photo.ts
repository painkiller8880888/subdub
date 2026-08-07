import sharp from "sharp";

import { AssetProcessingError } from "../asset-processing-errors.js";
import type { AssetProcessedMedia } from "./types.js";

export async function processPhotoMedia(
  mediaPath: string,
  maxThumbnailEdgePx: number
): Promise<AssetProcessedMedia> {
  try {
    const metadata = await sharp(mediaPath).metadata();
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new AssetProcessingError("PROCESSING_MEDIA_CORRUPTED");
    }
    const orientation = metadata.orientation ?? 1;
    const swapped = orientation >= 5 && orientation <= 8;
    const width = swapped ? metadata.height : metadata.width;
    const height = swapped ? metadata.width : metadata.height;

    const thumbnail = await sharp(mediaPath)
      .rotate()
      .resize({
        width: maxThumbnailEdgePx,
        height: maxThumbnailEdgePx,
        fit: "inside",
        withoutEnlargement: true
      })
      .png()
      .toBuffer();

    return {
      metadata: {
        width,
        height,
        durationMs: null,
        pageCount: null
      },
      thumbnails: [thumbnail]
    };
  } catch (error) {
    if (error instanceof AssetProcessingError) {
      throw error;
    }
    throw new AssetProcessingError("PROCESSING_MEDIA_CORRUPTED", {
      cause: error
    });
  }
}
