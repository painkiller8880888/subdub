import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  inspectVoicevoxWav,
  VoicevoxWavError
} from "../../src/voicevox/wav.js";
import { createVoicevoxWavFixture } from "../fixtures/voicevox.js";

function fourCc(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function wavWithUnknownPaddedChunk(): Uint8Array {
  const base = createVoicevoxWavFixture({ durationMs: 1_000 });
  const fmtChunk = base.slice(12, 36);
  const dataChunk = base.slice(36);
  const junkChunk = new Uint8Array([
    0x4a, 0x55, 0x4e, 0x4b, 0x03, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x00
  ]);
  const result = new Uint8Array(
    12 + fmtChunk.length + junkChunk.length + dataChunk.length
  );
  fourCc(result, 0, "RIFF");
  new DataView(result.buffer).setUint32(4, result.byteLength - 8, true);
  fourCc(result, 8, "WAVE");
  result.set(fmtChunk, 12);
  result.set(junkChunk, 12 + fmtChunk.length);
  result.set(dataChunk, 12 + fmtChunk.length + junkChunk.length);
  return result;
}

describe("VOICEVOX WAV metadata", () => {
  it("calculates rounded duration and the checksum from unchanged bytes", () => {
    const wav = createVoicevoxWavFixture({
      durationMs: 1.4,
      sampleRate: 24_000
    });
    const metadata = inspectVoicevoxWav(wav);

    expect(metadata.durationMs).toBe(1);
    expect(metadata.audioSha256).toBe(
      createHash("sha256").update(wav).digest("hex")
    );
  });

  it("ignores unknown chunks and RIFF padding", () => {
    expect(inspectVoicevoxWav(wavWithUnknownPaddedChunk()).durationMs).toBe(
      1_000
    );
  });

  it.each([
    [
      "invalid RIFF size",
      (wav: Uint8Array) =>
        new DataView(wav.buffer).setUint32(4, wav.byteLength, true)
    ],
    [
      "invalid data boundary",
      (wav: Uint8Array) =>
        new DataView(wav.buffer).setUint32(40, wav.byteLength, true)
    ],
    [
      "missing fmt payload",
      (wav: Uint8Array) => new DataView(wav.buffer).setUint32(16, 8, true)
    ]
  ])("rejects %s", (_label, mutate) => {
    const wav = createVoicevoxWavFixture();
    mutate(wav);
    expect(() => inspectVoicevoxWav(wav)).toThrow(VoicevoxWavError);
  });

  it("rejects zero-duration WAV data", () => {
    const wav = createVoicevoxWavFixture({ durationMs: 0 });
    expect(() => inspectVoicevoxWav(wav)).toThrow(VoicevoxWavError);
  });

  it("rejects PCM headers whose block alignment disagrees with channels and bit depth", () => {
    const wav = createVoicevoxWavFixture({ durationMs: 1_000 });
    const view = new DataView(wav.buffer);
    view.setUint16(32, 1, true);
    view.setUint32(28, 24_000, true);

    expect(() => inspectVoicevoxWav(wav)).toThrow(VoicevoxWavError);
  });
});
