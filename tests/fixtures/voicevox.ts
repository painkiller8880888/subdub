import type { VoicevoxSpeakersResponse } from "../../src/voicevox/schemas.js";

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
