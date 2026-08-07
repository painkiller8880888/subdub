import { registerMediabunnyServer } from "@mediabunny/server";
import {
  ALL_FORMATS,
  FilePathSource,
  Input,
  VideoSample,
  VideoSampleSink
} from "mediabunny";
import { createCanvas, ImageData } from "@napi-rs/canvas";

import { AssetProcessingError } from "../asset-processing-errors.js";
import type { AssetProcessedMedia } from "./types.js";

// Must be called before any mediabunny Input is created. Loading this module
// registers the FFmpeg-backed decoders via node-av. The module is only loaded
// lazily by the processing port, so startup stays independent of node-av.
registerMediabunnyServer();

function frameToPngBytes(
  rgba: Uint8ClampedArray,
  codedWidth: number,
  codedHeight: number,
  rotationDeg: number,
  maxEdgePx: number
): Buffer {
  const swap = rotationDeg === 90 || rotationDeg === 270;
  const displayWidth = swap ? codedHeight : codedWidth;
  const displayHeight = swap ? codedWidth : codedHeight;
  const scale = Math.min(1, maxEdgePx / Math.max(displayWidth, displayHeight));
  const targetWidth = Math.max(1, Math.round(displayWidth * scale));
  const targetHeight = Math.max(1, Math.round(displayHeight * scale));

  const source = createCanvas(codedWidth, codedHeight);
  source
    .getContext("2d")
    .putImageData(new ImageData(rgba, codedWidth, codedHeight), 0, 0);

  const output = createCanvas(targetWidth, targetHeight);
  const context = output.getContext("2d");
  context.translate(targetWidth / 2, targetHeight / 2);
  context.rotate((rotationDeg * Math.PI) / 180);
  context.scale(scale, scale);
  context.drawImage(source, -codedWidth / 2, -codedHeight / 2);
  return output.toBuffer("image/png");
}

function toProcessingError(error: unknown): unknown {
  if (error instanceof AssetProcessingError) {
    return error;
  }
  return new AssetProcessingError("PROCESSING_MEDIA_CORRUPTED", {
    cause: error
  });
}

function toMilliseconds(durationSeconds: number): number {
  return Math.round(durationSeconds * 1000);
}

export async function processVideoMedia(
  mediaPath: string,
  maxThumbnailEdgePx: number
): Promise<AssetProcessedMedia> {
  const input = new Input({
    source: new FilePathSource(mediaPath),
    formats: ALL_FORMATS
  });
  try {
    const durationSeconds = await input.computeDuration();
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
    }
    const videoTrack = await input.getPrimaryVideoTrack();
    if (videoTrack === null) {
      throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
    }
    const [width, height] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight()
    ]);
    const decodable = await videoTrack.canDecode();
    if (!decodable) {
      throw new AssetProcessingError("PROCESSING_MEDIA_CORRUPTED");
    }

    const sink = new VideoSampleSink(videoTrack);
    const sample = await sink.getSample(durationSeconds / 2);
    if (sample === null) {
      throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
    }
    try {
      const rect = sample.visibleRect;
      const allocation = sample.allocationSize({
        format: "RGBA",
        rect
      } as unknown as Parameters<VideoSample["allocationSize"]>[0]);
      const buffer = new ArrayBuffer(allocation);
      await sample.copyTo(buffer, {
        format: "RGBA",
        rect
      } as unknown as Parameters<VideoSample["copyTo"]>[1]);
      const rgba = new Uint8ClampedArray(
        buffer,
        0,
        rect.width * rect.height * 4
      );
      const thumbnail = frameToPngBytes(
        rgba,
        rect.width,
        rect.height,
        sample.rotation,
        maxThumbnailEdgePx
      );
      return {
        metadata: {
          width,
          height,
          durationMs: toMilliseconds(durationSeconds),
          pageCount: null
        },
        thumbnails: [thumbnail]
      };
    } finally {
      sample.close();
    }
  } catch (error) {
    throw toProcessingError(error);
  } finally {
    input.dispose();
  }
}

export async function processAudioMedia(
  mediaPath: string
): Promise<AssetProcessedMedia> {
  const input = new Input({
    source: new FilePathSource(mediaPath),
    formats: ALL_FORMATS
  });
  try {
    const durationSeconds = await input.computeDuration();
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
    }
    return {
      metadata: {
        width: null,
        height: null,
        durationMs: toMilliseconds(durationSeconds),
        pageCount: null
      },
      thumbnails: []
    };
  } catch (error) {
    throw toProcessingError(error);
  } finally {
    input.dispose();
  }
}
