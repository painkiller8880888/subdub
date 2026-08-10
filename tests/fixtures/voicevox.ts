import type {
  VoicevoxAudioQuery,
  VoicevoxSpeakersResponse
} from "../../src/voicevox/schemas.js";

let nextSyntheticStyleId = 10_000;

export function syntheticVoicevoxStyleId(): number {
  const id = nextSyntheticStyleId;
  nextSyntheticStyleId += 1;
  return id;
}

export function createVoicevoxSpeakersFixture(
  options: {
    readonly metanStyleId?: number;
    readonly zundamonStyleId?: number;
  } = {}
): VoicevoxSpeakersResponse {
  const metanStyleId = options.metanStyleId ?? syntheticVoicevoxStyleId();
  const zundamonStyleId = options.zundamonStyleId ?? syntheticVoicevoxStyleId();

  return [
    {
      name: "四国めたん",
      speaker_uuid: "metan-fixture-uuid",
      styles: [
        { name: "ノーマル", id: metanStyleId, type: "talk" },
        { name: "別スタイル", id: syntheticVoicevoxStyleId(), type: "talk" }
      ],
      supported_features: { interrogative_upspeak: true }
    },
    {
      name: "ずんだもん",
      speaker_uuid: "zundamon-fixture-uuid",
      styles: [
        { name: "ノーマル", id: zundamonStyleId, type: "talk" },
        { name: "別スタイル", id: syntheticVoicevoxStyleId(), type: "talk" }
      ],
      supported_features: { interrogative_upspeak: true }
    }
  ] as unknown as VoicevoxSpeakersResponse;
}

export function voicevoxJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export function createVoicevoxAudioQueryFixture(): VoicevoxAudioQuery {
  return {
    accent_phrases: [
      {
        moras: [
          {
            text: "コ",
            consonant: "k",
            consonant_length: 0.1,
            vowel: "o",
            vowel_length: 0.2,
            pitch: 5.5,
            future_mora_field: "preserve"
          }
        ],
        accent: 1,
        pause_mora: null,
        is_interrogative: false,
        future_phrase_field: { preserve: true }
      }
    ],
    speedScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    volumeScale: 1,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
    outputSamplingRate: 24_000,
    outputStereo: false,
    kana: "コ'レ",
    future_query_field: { preserve: true }
  };
}

export function createVoicevoxWavFixture(
  options: {
    readonly durationMs?: number;
    readonly sampleRate?: number;
    readonly channels?: number;
    readonly bitsPerSample?: number;
  } = {}
): Uint8Array {
  const durationMs = options.durationMs ?? 1_000;
  const sampleRate = options.sampleRate ?? 24_000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const frameCount = Math.round((sampleRate * durationMs) / 1_000);
  const dataLength = frameCount * blockAlign;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const writeFourCc = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  writeFourCc(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeFourCc(8, "WAVE");
  writeFourCc(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeFourCc(36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 44; index < bytes.byteLength; index += 1) {
    bytes[index] = index % 251;
  }

  return bytes;
}
