const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type PngMetadata = {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly hasAlpha: boolean;
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parsePng(buffer: Buffer): PngMetadata | string {
  if (buffer.length < PNG_SIGNATURE.length) {
    return "file is empty or too small to be a PNG";
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "PNG signature is invalid";
  }

  let offset = PNG_SIGNATURE.length;
  let ihdr: PngMetadata | null = null;
  let hasIdat = false;
  let hasTrns = false;
  let hasIend = false;

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      return "PNG chunk header is truncated";
    }

    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const chunkEnd = offset + length;
    if (chunkEnd + 4 > buffer.length) {
      return `PNG ${type || "unknown"} chunk is truncated`;
    }

    const data = buffer.subarray(offset, chunkEnd);
    const expectedCrc = buffer.readUInt32BE(chunkEnd);
    const actualCrc = crc32(buffer.subarray(offset - 4, chunkEnd));
    if (expectedCrc !== actualCrc) {
      return `PNG ${type || "unknown"} chunk has an invalid CRC`;
    }
    offset = chunkEnd + 4;

    if (ihdr === null && type !== "IHDR") {
      return "PNG must start with an IHDR chunk";
    }

    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) {
        return "PNG IHDR chunk is invalid";
      }
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        (colorType === 4 && [8, 16].includes(bitDepth)) ||
        (colorType === 6 && [8, 16].includes(bitDepth));
      if (
        width === 0 ||
        height === 0 ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        !validBitDepth ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] > 1
      ) {
        return "PNG IHDR values are invalid";
      }
      ihdr = {
        width,
        height,
        colorType,
        hasAlpha: colorType === 4 || colorType === 6
      };
    } else if (type === "IDAT") {
      hasIdat = true;
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "IEND") {
      if (length !== 0) {
        return "PNG IEND chunk is invalid";
      }
      hasIend = true;
      break;
    }
  }

  if (!hasIend || offset !== buffer.length) {
    return "PNG must end with an IEND chunk";
  }
  if (ihdr === null || !hasIdat) {
    return "PNG is missing required image data";
  }

  return {
    ...ihdr,
    hasAlpha: ihdr.hasAlpha || hasTrns
  };
}
