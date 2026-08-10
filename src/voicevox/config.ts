export const VOICEVOX_ENGINE_URL_ENV = "VOICEVOX_ENGINE_URL" as const;
export const DEFAULT_VOICEVOX_ENGINE_URL = "http://127.0.0.1:50021" as const;

export type Environment = Readonly<Record<string, string | undefined>>;

export function getVoicevoxEngineUrl(env: Environment = process.env): string {
  const value = env[VOICEVOX_ENGINE_URL_ENV];
  if (value === undefined) {
    return DEFAULT_VOICEVOX_ENGINE_URL;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? DEFAULT_VOICEVOX_ENGINE_URL : trimmed;
}

export function normalizeVoicevoxEngineUrl(engineUrl: string): string {
  return engineUrl.trim().replace(/\/+$/, "");
}

export function getVoicevoxSpeakersUrl(engineUrl: string): string {
  return `${normalizeVoicevoxEngineUrl(engineUrl)}/speakers`;
}

export function getVoicevoxVersionUrl(engineUrl: string): string {
  return `${normalizeVoicevoxEngineUrl(engineUrl)}/version`;
}

export function getVoicevoxAudioQueryUrl(
  engineUrl: string,
  text: string,
  resolvedStyleId: number
): string {
  const query = new URLSearchParams({
    text,
    speaker: String(resolvedStyleId)
  });
  return `${normalizeVoicevoxEngineUrl(engineUrl)}/audio_query?${query.toString()}`;
}

export function getVoicevoxSynthesisUrl(
  engineUrl: string,
  resolvedStyleId: number
): string {
  const query = new URLSearchParams({
    speaker: String(resolvedStyleId)
  });
  return `${normalizeVoicevoxEngineUrl(engineUrl)}/synthesis?${query.toString()}`;
}
