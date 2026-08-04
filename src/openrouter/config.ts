export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY" as const;

export type Environment = Readonly<Record<string, string | undefined>>;

export function getOpenRouterApiKey(
  env: Environment = process.env
): string | undefined {
  const value = env[OPENROUTER_API_KEY_ENV];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
