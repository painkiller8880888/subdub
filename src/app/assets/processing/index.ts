import { AssetProcessingError } from "../asset-processing-errors.js";
import type {
  AssetMediaProcessingInput,
  AssetMediaProcessingPort,
  AssetProcessedMedia
} from "./types.js";

export type {
  AssetMediaAnalysis,
  AssetMediaProcessingInput,
  AssetMediaProcessingPort,
  AssetProcessedMedia
} from "./types.js";

/**
 * Creates a media processing port that lazily loads the native media libraries
 * (FFmpeg via node-av, sharp, pdf.js) on first use. This keeps server startup
 * and tests free of native-module dependencies until processing is actually
 * invoked. Decoder startup failures surface as a distinguishable processing
 * error instead of crashing the process.
 */
export function createLazyMediaProcessingPort(): AssetMediaProcessingPort {
  let port: AssetMediaProcessingPort | undefined;

  return {
    async processMedia(
      input: AssetMediaProcessingInput
    ): Promise<AssetProcessedMedia> {
      if (port === undefined) {
        try {
          const module = await import("./real-media-processing.js");
          port = module.createRealMediaProcessingPort();
        } catch (error) {
          throw new AssetProcessingError("PROCESSING_INTERNAL_FAILED", {
            cause: error
          });
        }
      }
      return port.processMedia(input);
    }
  };
}
