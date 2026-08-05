export type AutosaveStatus =
  "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

export type AutosaveState = {
  readonly status: AutosaveStatus;
  readonly error: unknown;
};

export type AutosaveCoordinatorOptions<T> = {
  readonly debounceMs: number;
  readonly save: (draft: T) => Promise<void>;
  readonly isConflict: (error: unknown) => boolean;
  readonly onStateChange: (state: AutosaveState) => void;
};

export class AutosaveCoordinator<T> {
  private readonly debounceMs: number;
  private readonly save: (draft: T) => Promise<void>;
  private readonly isConflict: (error: unknown) => boolean;
  private readonly onStateChange: (state: AutosaveState) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private draft: T | undefined;
  private version = 0;
  private saving = false;
  private blocked = false;
  private disposed = false;
  private generation = 0;
  private savedVersion = 0;
  private activeFlush: Promise<boolean> | undefined;

  constructor(options: AutosaveCoordinatorOptions<T>) {
    this.debounceMs = Math.max(0, options.debounceMs);
    this.save = options.save;
    this.isConflict = options.isConflict;
    this.onStateChange = options.onStateChange;
  }

  update(draft: T): void {
    if (this.disposed) {
      return;
    }

    this.draft = draft;
    this.version += 1;
    if (this.blocked) {
      this.emit({ status: "conflict", error: undefined });
      return;
    }

    this.emit({ status: "pending", error: undefined });
    this.schedule(this.debounceMs);
  }

  replaceDraft(draft: T): void {
    if (this.disposed) {
      return;
    }

    this.draft = draft;
  }

  retry(): void {
    if (
      this.disposed ||
      this.blocked ||
      this.draft === undefined ||
      this.version === this.savedVersion
    ) {
      return;
    }

    this.emit({ status: "pending", error: undefined });
    this.schedule(0);
  }

  reset(): void {
    this.clearTimer();
    this.generation += 1;
    this.draft = undefined;
    this.version += 1;
    this.savedVersion = this.version;
    this.blocked = false;
    if (!this.disposed) {
      this.emit({ status: "idle", error: undefined });
    }
  }

  dispose(): void {
    this.clearTimer();
    this.generation += 1;
    this.disposed = true;
    this.draft = undefined;
    this.version += 1;
    this.savedVersion = this.version;
  }

  async flush(): Promise<boolean> {
    if (this.disposed || this.blocked) {
      return false;
    }

    this.clearTimer();
    if (this.draft === undefined || this.version === this.savedVersion) {
      return true;
    }

    if (this.activeFlush !== undefined) {
      return this.activeFlush;
    }

    const operation = this.flushAll();
    this.activeFlush = operation;
    try {
      return await operation;
    } finally {
      if (this.activeFlush === operation) {
        this.activeFlush = undefined;
      }
    }
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delayMs);
  }

  private async flushAll(): Promise<boolean> {
    while (
      !this.disposed &&
      !this.blocked &&
      this.draft !== undefined &&
      this.version !== this.savedVersion
    ) {
      const succeeded = await this.flushOne();
      if (!succeeded) {
        return false;
      }
    }

    return !this.blocked;
  }

  private async flushOne(): Promise<boolean> {
    if (
      this.disposed ||
      this.saving ||
      this.blocked ||
      this.draft === undefined ||
      this.version === this.savedVersion
    ) {
      return true;
    }

    const draft = this.draft;
    const saveVersion = this.version;
    const saveGeneration = this.generation;
    this.saving = true;
    this.emit({ status: "saving", error: undefined });

    try {
      await this.save(draft);
      if (saveGeneration !== this.generation) {
        return true;
      }
      if (this.version === saveVersion) {
        this.savedVersion = saveVersion;
        this.emit({ status: "saved", error: undefined });
      } else if (!this.blocked) {
        this.emit({ status: "pending", error: undefined });
      }
      return true;
    } catch (error) {
      if (saveGeneration !== this.generation) {
        return true;
      }
      if (this.isConflict(error)) {
        this.blocked = true;
        this.emit({ status: "conflict", error });
      } else {
        this.emit({ status: "error", error });
      }
      return false;
    } finally {
      this.saving = false;
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private emit(state: AutosaveState): void {
    if (!this.disposed) {
      this.onStateChange(state);
    }
  }
}

export async function navigateAfterAutosave<T>(
  coordinator: AutosaveCoordinator<T> | null,
  destination: string,
  navigate: (destination: string) => void
): Promise<boolean> {
  const flushed = coordinator === null ? true : await coordinator.flush();
  if (flushed) {
    navigate(destination);
  }
  return flushed;
}
