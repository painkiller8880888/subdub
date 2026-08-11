import sharp from "sharp";

/**
 * A small, explicit tolerance absorbs font/video-decoder rasterization noise
 * after a fixed-size sRGB/alpha normalization while remaining sensitive to a
 * real layout, material, or subtitle change.
 */
export const REPRESENTATIVE_FRAME_COMPARISON = {
  channelTolerance: 8,
  mismatchRatio: 0.0025,
  normalizedWidth: 320,
  normalizedHeight: 180,
  blurSigma: 0.3
} as const;

export type ImageComparisonStats = {
  readonly frameName: string;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly mismatchRatio: number;
  readonly maxChannelDifference: number;
};

type NormalizedImage = {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
};

async function normalizeImage(imagePath: string): Promise<NormalizedImage> {
  const metadata = await sharp(imagePath).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const channels = metadata.channels;
  if (width === undefined || height === undefined || channels === undefined) {
    throw new Error(
      `Representative frame image metadata is incomplete: ${imagePath}`
    );
  }

  const { data, info } = await sharp(imagePath)
    .toColorspace("srgb")
    .ensureAlpha()
    .resize({
      width: REPRESENTATIVE_FRAME_COMPARISON.normalizedWidth,
      height: REPRESENTATIVE_FRAME_COMPARISON.normalizedHeight,
      fit: "fill"
    })
    .blur(REPRESENTATIVE_FRAME_COMPARISON.blurSigma)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels
  };
}

export async function compareRepresentativeImages(
  actualPath: string,
  goldenPath: string,
  frameName: string
): Promise<ImageComparisonStats> {
  const [actualMetadata, goldenMetadata] = await Promise.all([
    sharp(actualPath).metadata(),
    sharp(goldenPath).metadata()
  ]);
  const actualDimensions = [
    actualMetadata.width,
    actualMetadata.height,
    actualMetadata.channels
  ];
  const goldenDimensions = [
    goldenMetadata.width,
    goldenMetadata.height,
    goldenMetadata.channels
  ];
  if (
    actualDimensions[0] !== goldenDimensions[0] ||
    actualDimensions[1] !== goldenDimensions[1] ||
    actualDimensions[2] !== goldenDimensions[2]
  ) {
    throw new Error(
      `Representative frame ${frameName} dimensions/channels differ: ` +
        `actual=${actualDimensions.join("x")} golden=${goldenDimensions.join("x")}`
    );
  }

  const [actual, golden] = await Promise.all([
    normalizeImage(actualPath),
    normalizeImage(goldenPath)
  ]);
  if (
    actual.width !== golden.width ||
    actual.height !== golden.height ||
    actual.channels !== golden.channels
  ) {
    throw new Error(
      `Representative frame ${frameName} normalized dimensions/channels differ: ` +
        `actual=${actual.width}x${actual.height}x${actual.channels} ` +
        `golden=${golden.width}x${golden.height}x${golden.channels}`
    );
  }

  const pixelCount = actual.width * actual.height;
  let mismatchPixels = 0;
  let maxChannelDifference = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * actual.channels;
    let pixelMismatch = false;
    for (let channel = 0; channel < actual.channels; channel += 1) {
      const difference = Math.abs(
        (actual.data[offset + channel] ?? 0) -
          (golden.data[offset + channel] ?? 0)
      );
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      if (difference > REPRESENTATIVE_FRAME_COMPARISON.channelTolerance) {
        pixelMismatch = true;
      }
    }
    if (pixelMismatch) {
      mismatchPixels += 1;
    }
  }

  const mismatchRatio = mismatchPixels / pixelCount;
  const stats: ImageComparisonStats = {
    frameName,
    width: actualMetadata.width ?? 0,
    height: actualMetadata.height ?? 0,
    channels: actualMetadata.channels ?? 0,
    mismatchRatio,
    maxChannelDifference
  };
  if (mismatchRatio > REPRESENTATIVE_FRAME_COMPARISON.mismatchRatio) {
    throw new Error(
      `Representative frame ${frameName} mismatch ratio ${mismatchRatio.toFixed(6)} ` +
        `exceeds ${REPRESENTATIVE_FRAME_COMPARISON.mismatchRatio}; ` +
        `max channel difference=${maxChannelDifference}`
    );
  }
  return stats;
}
