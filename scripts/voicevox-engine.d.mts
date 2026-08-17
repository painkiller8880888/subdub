export const VOICEVOX_ENGINE_URL_ENV: string;
export const VOICEVOX_ENGINE_HOST: string;
export const VOICEVOX_ENGINE_PORT: number;
export const DEFAULT_VOICEVOX_ENGINE_URL: string;
export const VOICEVOX_ENGINE_READINESS_TIMEOUT_MS: number;
export const VOICEVOX_ENGINE_POLL_INTERVAL_MS: number;
export const VOICEVOX_ENGINE_REQUEST_TIMEOUT_MS: number;

export type VoicevoxEngineReadiness = {
  readonly ready: boolean;
  readonly reason: string;
};

export type VoicevoxEngineManagerResult = {
  readonly status: string;
  readonly managedBySubdub: boolean;
  readonly engineUrl: string;
  readonly reason?: string;
};

export function getVoicevoxEngineUrl(
  env?: Readonly<Record<string, string | undefined>>
): string;
export function isDefaultVoicevoxEngineUrl(engineUrl: string): boolean;
export function getVoicevoxRunPath(
  env?: Readonly<Record<string, string | undefined>>,
  platform?: string
): string | null;
export function checkVoicevoxEngineReady(
  engineUrl: string,
  options?: Record<string, unknown>
): Promise<VoicevoxEngineReadiness>;
export function waitForVoicevoxReadiness(
  engineUrl: string,
  options?: Record<string, unknown>
): Promise<VoicevoxEngineReadiness>;

export function createVoicevoxEngineManager(
  options?: Record<string, unknown>
): {
  start(options?: {
    readonly signal?: AbortSignal;
  }): Promise<VoicevoxEngineManagerResult>;
  stop(): Promise<void>;
  getState(): VoicevoxEngineManagerResult;
};
