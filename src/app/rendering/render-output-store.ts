import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { idSchema, type RenderJobKind } from "../../schema/index.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";

export type RenderOutputTarget = {
  readonly temporaryPath: string;
  readonly finalPath: string;
  readonly outputPath: string;
};

export type RenderOutputPromotion = {
  readonly outputPath: string;
  readonly outputChecksum: string;
};

export type RenderOutputStorePort = {
  prepare(
    projectId: string,
    kind: RenderJobKind,
    runId: string
  ): Promise<RenderOutputTarget>;
  promote(target: RenderOutputTarget): Promise<RenderOutputPromotion>;
  cleanup(target: RenderOutputTarget | undefined): Promise<void>;
};

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function safeId(
  value: string,
  code:
    | typeof RENDER_JOB_ERROR_CODE.projectIdInvalid
    | typeof RENDER_JOB_ERROR_CODE.runIdInvalid
) {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new RenderJobError(code, 400, "The render run ID is invalid.");
  }
  return result.data;
}

function outputNames(kind: RenderJobKind): {
  readonly extension: "mp4" | "png";
  readonly prefix: "render" | "thumbnail";
} {
  return kind === "mp4"
    ? { extension: "mp4", prefix: "render" }
    : { extension: "png", prefix: "thumbnail" };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export type RenderOutputStoreOptions = {
  readonly workspaceRoot: string;
};

export class RenderOutputStore implements RenderOutputStorePort {
  private readonly workspaceRoot: string;

  constructor(options: RenderOutputStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  async prepare(
    projectId: string,
    kind: RenderJobKind,
    runId: string
  ): Promise<RenderOutputTarget> {
    const safeProjectId = safeId(
      projectId,
      RENDER_JOB_ERROR_CODE.projectIdInvalid
    );
    const safeRunId = safeId(runId, RENDER_JOB_ERROR_CODE.runIdInvalid);
    const outputRoot = path.resolve(
      this.workspaceRoot,
      "projects",
      safeProjectId,
      "output"
    );
    if (!isPathInside(this.workspaceRoot, outputRoot)) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
        500,
        "The render output path is invalid."
      );
    }

    try {
      await fs.mkdir(outputRoot, { recursive: true });
      const resolvedRoot = await fs.realpath(outputRoot);
      const resolvedWorkspaceRoot = await fs.realpath(this.workspaceRoot);
      if (!isPathInside(resolvedWorkspaceRoot, resolvedRoot)) {
        throw new Error("output path escaped workspace");
      }
    } catch {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
        500,
        "The temporary render output could not be prepared."
      );
    }

    const names = outputNames(kind);
    const outputPath = `output/${names.prefix}-${safeRunId}.${names.extension}`;
    const finalPath = path.join(
      outputRoot,
      `${names.prefix}-${safeRunId}.${names.extension}`
    );
    const temporaryPath = path.join(
      outputRoot,
      `.${names.prefix}-${safeRunId}.${names.extension}.tmp`
    );
    return { temporaryPath, finalPath, outputPath };
  }

  async promote(target: RenderOutputTarget): Promise<RenderOutputPromotion> {
    let stats;
    try {
      stats = await fs.stat(target.temporaryPath);
    } catch {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
        500,
        "The temporary render output is missing."
      );
    }
    if (!stats.isFile() || stats.size <= 0) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
        500,
        "The temporary render output is empty."
      );
    }

    try {
      await fs.stat(target.finalPath);
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.finalOutputWriteFailed,
        500,
        "The final render output already exists."
      );
    } catch (error) {
      if (error instanceof RenderJobError || !isMissingPathError(error)) {
        if (error instanceof RenderJobError) {
          throw error;
        }
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.finalOutputWriteFailed,
          500,
          "The final render output could not be checked."
        );
      }
    }

    let outputChecksum: string;
    try {
      outputChecksum = await sha256File(target.temporaryPath);
    } catch {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.temporaryOutputWriteFailed,
        500,
        "The temporary render output checksum could not be calculated."
      );
    }

    try {
      await fs.rename(target.temporaryPath, target.finalPath);
    } catch {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.finalOutputWriteFailed,
        500,
        "The final render output could not be promoted."
      );
    }
    return { outputPath: target.outputPath, outputChecksum };
  }

  async cleanup(target: RenderOutputTarget | undefined): Promise<void> {
    if (target === undefined) {
      return;
    }
    try {
      await fs.unlink(target.temporaryPath);
    } catch {
      // Cleanup is scoped to this run's temporary output and is best effort.
    }
  }
}
