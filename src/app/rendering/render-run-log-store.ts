import { renderRunLogSchema, type RenderRunLog } from "../../schema/index.js";
import {
  RunLogStore,
  RunLogStoreError,
  type RunLogStoreFileSystem,
  type RunLogStorePort
} from "../run-log-store.js";

export type RenderRunLogStoreErrorCode =
  | "RENDER_PROJECT_ID_INVALID"
  | "RENDER_RUN_ID_INVALID"
  | "RENDER_RUN_LOG_PATH_INVALID"
  | "RENDER_RUN_NOT_FOUND"
  | "RENDER_RUN_LOG_READ_FAILED"
  | "RENDER_RUN_LOG_INVALID"
  | "RENDER_RUN_LOG_WRITE_FAILED";

export class RenderRunLogStoreError extends Error {
  readonly code: RenderRunLogStoreErrorCode;
  readonly status: 400 | 404 | 500;

  constructor(
    code: RenderRunLogStoreErrorCode,
    status: 400 | 404 | 500,
    message = code
  ) {
    super(message);
    this.name = "RenderRunLogStoreError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
  }
}

export type RenderRunLogStoreFileSystem = RunLogStoreFileSystem;

export type RenderRunLogStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<RenderRunLogStoreFileSystem>;
  readonly createId?: () => string;
  readonly runLogStore?: RunLogStorePort;
};

export type RenderRunLogStorePort = Pick<RenderRunLogStore, "read" | "write">;

function mapError(error: unknown): RenderRunLogStoreError {
  if (!(error instanceof RunLogStoreError)) {
    return new RenderRunLogStoreError("RENDER_RUN_LOG_WRITE_FAILED", 500);
  }

  switch (error.code) {
    case "RUN_LOG_PROJECT_ID_INVALID":
      return new RenderRunLogStoreError("RENDER_PROJECT_ID_INVALID", 400);
    case "RUN_LOG_ID_INVALID":
      return new RenderRunLogStoreError("RENDER_RUN_ID_INVALID", 400);
    case "RUN_LOG_PATH_INVALID":
      return new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
    case "RUN_LOG_NOT_FOUND":
      return new RenderRunLogStoreError("RENDER_RUN_NOT_FOUND", 404);
    case "RUN_LOG_READ_FAILED":
      return new RenderRunLogStoreError("RENDER_RUN_LOG_READ_FAILED", 500);
    case "RUN_LOG_INVALID":
      return new RenderRunLogStoreError("RENDER_RUN_LOG_INVALID", 500);
    case "RUN_LOG_WRITE_FAILED":
      return new RenderRunLogStoreError("RENDER_RUN_LOG_WRITE_FAILED", 500);
  }
}

/**
 * Backwards-compatible render port. It exposes the old API view, while all
 * filesystem reads and writes are delegated to the common RunLogStore.
 */
export class RenderRunLogStore {
  private readonly runLogStore: RunLogStorePort;

  constructor(options: RenderRunLogStoreOptions) {
    this.runLogStore =
      options.runLogStore ??
      new RunLogStore({
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.fileSystem,
        createId: options.createId
      });
  }

  async read(projectId: unknown, runId: unknown): Promise<RenderRunLog> {
    try {
      const commonLog = await this.runLogStore.read(projectId, runId);
      const parsed = renderRunLogSchema.safeParse(commonLog);
      if (!parsed.success) {
        throw new RenderRunLogStoreError("RENDER_RUN_LOG_INVALID", 500);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof RenderRunLogStoreError) {
        throw error;
      }
      throw mapError(error);
    }
  }

  async write(
    projectId: unknown,
    runLog: unknown,
    expectedRunId?: unknown
  ): Promise<void> {
    try {
      await this.runLogStore.write(projectId, runLog, expectedRunId);
    } catch (error) {
      throw mapError(error);
    }
  }
}
