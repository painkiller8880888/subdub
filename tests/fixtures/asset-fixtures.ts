import { deflateSync } from "node:zlib";

export const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

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

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  checksum.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, crcInput, checksum]);
}

export function makeTransparentPng(
  width: number,
  height: number,
  alpha = 0
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      scanlines[rowStart + 1 + x * 4 + 3] = alpha;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);

export const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  "latin1"
);

export const wavBytes = ((): Buffer => {
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(0, 40);
  return buffer;
})();

export const mp4Bytes = ((): Buffer => {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(32, 0);
  buffer.write("ftyp", 4, "latin1");
  buffer.write("isom", 8, "latin1");
  buffer.writeUInt32BE(0x00000200, 12);
  buffer.write("isomiso2avc1mp41", 16, "latin1");
  return buffer;
})();

export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; mimeType: string; data: Buffer };

export function buildMultipartBody(parts: readonly MultipartPart[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = "----subdub-test-boundary";
  const chunks: Buffer[] = [];

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        )
      );
      chunks.push(Buffer.from(`Content-Type: ${part.mimeType}\r\n\r\n`));
      chunks.push(part.data);
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
        )
      );
      chunks.push(Buffer.from(part.value, "utf8"));
    }
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}
