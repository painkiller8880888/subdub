export const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

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
