import { createHash } from "node:crypto";

export type VoicevoxWavMetadata = {
  readonly durationMs: number;
  readonly audioSha256: string;
};

export class VoicevoxWavError extends Error {
  readonly code = "VOICEVOX_WAV_INVALID" as const;

  constructor() {
    super("VOICEVOX_WAV_INVALID");
    this.name = "VoicevoxWavError";
  }
}

function invalidWav(): never {
  throw new VoicevoxWavError();
}

function readFourCc(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    return invalidWav();
  }

  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    return invalidWav();
  }

  return view.getUint32(offset, true);
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    return invalidWav();
  }

  return view.getUint16(offset, true);
}

export function inspectVoicevoxWav(audio: Uint8Array): VoicevoxWavMetadata {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 12) {
    return invalidWav();
  }

  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  if (readFourCc(audio, 0) !== "RIFF" || readFourCc(audio, 8) !== "WAVE") {
    return invalidWav();
  }

  const riffSize = readUint32(view, 4);
  if (riffSize < 4 || riffSize + 8 !== audio.byteLength) {
    return invalidWav();
  }

  const riffEnd = riffSize + 8;
  let offset = 12;
  let fmt:
    | {
        readonly audioFormat: number;
        readonly channels: number;
        readonly sampleRate: number;
        readonly byteRate: number;
        readonly blockAlign: number;
        readonly bitsPerSample: number;
      }
    | undefined;
  let dataBytes = 0;

  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) {
      return invalidWav();
    }

    const chunkId = readFourCc(audio, offset);
    const chunkSize = readUint32(view, offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;
    const nextOffset = chunkDataEnd + (chunkSize % 2);
    if (chunkDataEnd > riffEnd || nextOffset > riffEnd) {
      return invalidWav();
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16 || fmt !== undefined) {
        return invalidWav();
      }

      fmt = {
        audioFormat: readUint16(view, chunkDataStart),
        channels: readUint16(view, chunkDataStart + 2),
        sampleRate: readUint32(view, chunkDataStart + 4),
        byteRate: readUint32(view, chunkDataStart + 8),
        blockAlign: readUint16(view, chunkDataStart + 12),
        bitsPerSample: readUint16(view, chunkDataStart + 14)
      };
    } else if (chunkId === "data") {
      if (chunkSize === 0) {
        return invalidWav();
      }
      dataBytes += chunkSize;
    }

    offset = nextOffset;
  }

  if (offset !== riffEnd || fmt === undefined || dataBytes <= 0) {
    return invalidWav();
  }

  if (
    fmt.audioFormat <= 0 ||
    fmt.channels <= 0 ||
    fmt.sampleRate <= 0 ||
    fmt.byteRate <= 0 ||
    fmt.blockAlign <= 0 ||
    fmt.bitsPerSample <= 0 ||
    fmt.byteRate !== fmt.sampleRate * fmt.blockAlign ||
    dataBytes % fmt.blockAlign !== 0
  ) {
    return invalidWav();
  }

  const durationMs = Math.round(
    (dataBytes / fmt.blockAlign / fmt.sampleRate) * 1000
  );
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    return invalidWav();
  }

  return {
    durationMs,
    audioSha256: createHash("sha256").update(audio).digest("hex")
  };
}

export const getVoicevoxWavMetadata = inspectVoicevoxWav;
