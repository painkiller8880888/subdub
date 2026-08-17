export const packageManagerCommand: string;
export const packageManagerArgs: string[];
export const CHILD_PROCESS_STOP_TIMEOUT_MS: number;

export type ManagedChildProcess = {
  readonly pid?: number;
  readonly exitCode?: number | null;
  readonly signalCode?: string | null;
  readonly kill?: (signal?: string) => boolean;
  readonly once?: (event: string, listener: () => void) => unknown;
  readonly removeListener?: (event: string, listener: () => void) => unknown;
};

export function run(
  command: string,
  args: string[],
  options?: Record<string, unknown>
): Promise<number>;
export function runPnpm(
  args: string[],
  options?: Record<string, unknown>
): Promise<number>;
export function stopChildProcess(
  child: ManagedChildProcess,
  options?: {
    readonly platform?: string;
    readonly timeoutMs?: number;
  }
): Promise<void>;
