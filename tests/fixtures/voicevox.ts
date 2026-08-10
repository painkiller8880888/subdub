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
