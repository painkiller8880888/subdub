import type {
  AssetMediaProcessingInput,
  AssetMediaProcessingPort,
  AssetProcessedMedia
} from "./types.js";
import { processAudioMedia, processVideoMedia } from "./video-audio.js";
import { processPdfMedia } from "./pdf.js";
import { processPhotoMedia } from "./photo.js";

export function createRealMediaProcessingPort(): AssetMediaProcessingPort {
  return {
    processMedia(
      input: AssetMediaProcessingInput
    ): Promise<AssetProcessedMedia> {
      switch (input.kind) {
        case "video":
          return processVideoMedia(input.mediaPath, input.maxThumbnailEdgePx);
        case "bgm":
        case "sound_effect":
          return processAudioMedia(input.mediaPath);
        case "photo":
          return processPhotoMedia(input.mediaPath, input.maxThumbnailEdgePx);
        case "document_scan":
          return processPdfMedia(input.mediaPath, input.maxThumbnailEdgePx);
      }
    }
  };
}
