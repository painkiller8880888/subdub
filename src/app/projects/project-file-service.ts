import { realpath, stat } from "node:fs/promises";
import * as path from "node:path";

import {
  idSchema,
  relativePosixPathSchema
} from "../../schema/index.js";

export type ProjectFileServiceErrorCode =
  | "PROJECT_FILE_PROJECT_ID_INVALID"
  | "PROJECT_FILE_PATH_INVALID"
  | "PROJECT_FILE_NOT_FOUND"
  | "PROJECT_FILE_READ_FAILED";

export class ProjectFileServiceError extends Error {
  readonly code: ProjectFileServiceErrorCode;
  readonly status: 400 | 404 | 500;

  constructor(
    code: ProjectFileServiceErrorCode,
    status: 400 | 404 | 500
  ) {
    super(code);
    this.name = "ProjectFileServiceError";
    this.code = code;
    this.status = status;
  }
}

export type ProjectFileDescriptor = {
  readonly filePath: string;
  readonly size: number;
  readonly contentType: string;
};

export type ProjectFileServiceOptions = {
  readonly workspaceRoot: string;
};

const projectFileRootNames = new Set([
  "media",
  "audio",
  "backgrounds",
  "output"
]);
const previewOutputFilePattern =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:sd|hd|fhd)\.mp4$/;

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function invalidPathError(): ProjectFileServiceError {
  return new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
}

function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function normalizeProjectFilePath(value: unknown): string {
  const parsed = relativePosixPathSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidPathError();
  }

  const relativePath = parsed.data;
  if (
    relativePath.includes("%") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(relativePath) ||
    relativePath.includes("://")
  ) {
    throw invalidPathError();
  }

  const [rootName, outputKind, outputFileName] = relativePath.split("/");
  if (rootName === undefined || !projectFileRootNames.has(rootName)) {
    throw invalidPathError();
  }
  if (rootName === "output") {
    if (
      outputKind !== "previews" ||
      outputFileName === undefined ||
      !previewOutputFilePattern.test(outputFileName) ||
      relativePath.split("/").length !== 3
    ) {
      throw invalidPathError();
    }
  }
  return relativePath;
}

export class ProjectFileService {
  private readonly workspaceRoot: string;

  constructor(options: ProjectFileServiceOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
  }

  async resolveFile(
    projectId: unknown,
    relativePath: unknown
  ): Promise<ProjectFileDescriptor> {
    const parsedProjectId = idSchema.safeParse(projectId);
    if (!parsedProjectId.success) {
      throw new ProjectFileServiceError(
        "PROJECT_FILE_PROJECT_ID_INVALID",
        400
      );
    }
    const safeRelativePath = normalizeProjectFilePath(relativePath);

    let resolvedWorkspaceRoot: string;
    let resolvedProjectsRoot: string;
    let resolvedProjectRoot: string;
    try {
      resolvedWorkspaceRoot = await realpath(this.workspaceRoot);
      resolvedProjectsRoot = await realpath(
        path.join(this.workspaceRoot, "projects")
      );
      resolvedProjectRoot = await realpath(
        path.join(this.workspaceRoot, "projects", parsedProjectId.data)
      );
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new ProjectFileServiceError("PROJECT_FILE_NOT_FOUND", 404);
      }
      throw new ProjectFileServiceError("PROJECT_FILE_READ_FAILED", 500);
    }

    if (
      !isPathInside(resolvedWorkspaceRoot, resolvedProjectsRoot) ||
      !isPathInside(resolvedProjectsRoot, resolvedProjectRoot)
    ) {
      throw invalidPathError();
    }

    const candidatePath = path.resolve(
      resolvedProjectRoot,
      ...safeRelativePath.split("/")
    );
    if (!isPathInside(resolvedProjectRoot, candidatePath)) {
      throw invalidPathError();
    }

    let resolvedCandidatePath: string;
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      resolvedCandidatePath = await realpath(candidatePath);
      if (!isPathInside(resolvedProjectRoot, resolvedCandidatePath)) {
        throw invalidPathError();
      }
      fileStats = await stat(resolvedCandidatePath);
    } catch (error) {
      if (error instanceof ProjectFileServiceError) {
        throw error;
      }
      if (isMissingPathError(error)) {
        throw new ProjectFileServiceError("PROJECT_FILE_NOT_FOUND", 404);
      }
      throw new ProjectFileServiceError("PROJECT_FILE_READ_FAILED", 500);
    }

    if (!fileStats.isFile()) {
      throw new ProjectFileServiceError("PROJECT_FILE_NOT_FOUND", 404);
    }

    return {
      filePath: resolvedCandidatePath,
      size: fileStats.size,
      contentType: contentTypeForPath(resolvedCandidatePath)
    };
  }
}
