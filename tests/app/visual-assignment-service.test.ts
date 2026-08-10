import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AssetRepository } from "../../src/app/assets/asset-repository.js";
import {
  ProjectRepository,
  ProjectRepositoryError
} from "../../src/app/projects/project-repository.js";
import {
  VISUAL_ASSIGNMENT_ERROR_CODE,
  VisualAssignmentError
} from "../../src/app/projects/visual-assignment-errors.js";
import { VisualAssignmentService } from "../../src/app/projects/visual-assignment-service.js";
import type { VisualAssignmentFileSystem } from "../../src/app/projects/visual-assignment-file-system.js";
import {
  videoProjectSchema,
  type AssetDetail,
  type VideoProject
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const NOW = "2026-08-10T04:00:00.000Z";
const PROJECT_ID = "visual-assignment-project";
const ASSET_ID = "asset-photo";
const SOURCE_BYTES = Buffer.from("visual assignment source bytes", "utf8");
const SOURCE_CHECKSUM = createHash("sha256").update(SOURCE_BYTES).digest("hex");

function clone<T>(value: T): T {
  return structuredClone(value);
}

function photoDisplay(): VideoProject["visuals"]["assignments"][number]["display"] {
  return clone(videoProjectFixture.visuals.assignments[1].display);
}

function createAsset(
  overrides: Partial<AssetDetail> = {},
  bytes: Uint8Array = SOURCE_BYTES
): AssetDetail {
  const kind = overrides.kind ?? "photo";
  const extension =
    kind === "video"
      ? "mp4"
      : kind === "document_scan"
        ? "pdf"
        : kind === "sound_effect"
          ? "wav"
          : "png";
  const mimeType =
    kind === "video"
      ? "video/mp4"
      : kind === "document_scan"
        ? "application/pdf"
        : kind === "sound_effect"
          ? "audio/wav"
          : "image/png";
  return {
    assetId: ASSET_ID,
    version: 1,
    kind,
    title: "申請画面",
    description: "",
    confidentiality: "internal",
    department: null,
    system: "申請システム",
    mimeType,
    libraryMediaPath: `media/${ASSET_ID}/v1.${extension}`,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    width: 1,
    height: 1,
    durationMs: null,
    pageCount: null,
    thumbnailPaths: [],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function createAssignment(
  id = "new-visual-assignment",
  assetId = ASSET_ID,
  display = photoDisplay()
): {
  id: string;
  startLineId: string;
  endLineId: string;
  assetId: string;
  display: typeof display;
} {
  return {
    id,
    startLineId: "main-mentor-1",
    endLineId: "main-learner-1",
    assetId,
    display
  };
}

type SetupOptions = {
  readonly asset?: AssetDetail | undefined;
  readonly bytes?: Uint8Array;
  readonly fileSystem?: Partial<VisualAssignmentFileSystem>;
  readonly repository?: Pick<ProjectRepository, "read" | "save">;
};

describe("VisualAssignmentService", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function setup(options: SetupOptions = {}) {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-visual-assignment-")
    );
    roots.push(workspaceRoot);
    const projectRoot = path.join(workspaceRoot, "projects", PROJECT_ID);
    const libraryRoot = path.join(workspaceRoot, "library");
    await fs.mkdir(projectRoot, { recursive: true });
    const bytes = options.bytes ?? SOURCE_BYTES;
    const asset = options.asset ?? createAsset({}, bytes);
    await fs.mkdir(
      path.dirname(path.join(libraryRoot, asset.libraryMediaPath)),
      {
        recursive: true
      }
    );
    await fs.writeFile(path.join(libraryRoot, asset.libraryMediaPath), bytes);

    const project = clone(videoProjectFixture) as VideoProject;
    project.metadata.id = PROJECT_ID;
    project.metadata.updatedAt = NOW;
    project.visuals.assignments = [];
    videoProjectSchema.parse(project);
    const projectFile = path.join(projectRoot, "project.json");
    await fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);

    const repository =
      options.repository ??
      new ProjectRepository({ workspaceRoot, now: () => new Date(NOW) });
    const assetRepository: Pick<AssetRepository, "findAssetDetail"> = {
      findAssetDetail: () => asset
    };
    const service = new VisualAssignmentService({
      repository,
      assetRepository,
      workspaceRoot,
      libraryRoot,
      fileSystem: options.fileSystem,
      createId: () => "temp-file-id"
    });
    return {
      workspaceRoot,
      projectRoot,
      libraryRoot,
      projectFile,
      asset,
      bytes,
      repository,
      service
    };
  }

  async function readProject(projectFile: string): Promise<VideoProject> {
    return videoProjectSchema.parse(
      JSON.parse(await fs.readFile(projectFile, "utf8"))
    );
  }

  async function expectError(
    operation: () => Promise<unknown>,
    code: string
  ): Promise<VisualAssignmentError | ProjectRepositoryError> {
    const error = await operation().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    return error as VisualAssignmentError | ProjectRepositoryError;
  }

  async function finalPath(projectRoot: string): Promise<string> {
    return path.join(projectRoot, "media", "visuals", ASSET_ID, "v1.png");
  }

  it("copies, verifies, and persists the backend-owned assignment reference", async () => {
    const context = await setup();

    const result = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    const destination = await finalPath(context.projectRoot);
    const savedProject = await readProject(context.projectFile);

    expect(result.revision).toBe(1);
    expect(result.data.revision).toBe(1);
    expect(await fs.readFile(destination)).toEqual(context.bytes);
    expect(
      savedProject.visuals.assignments.map((assignment) => ({
        id: assignment.id,
        assetId: assignment.assetId,
        assetChecksum: assignment.assetChecksum,
        projectMediaPath: assignment.projectMediaPath
      }))
    ).toEqual([
      {
        id: "new-visual-assignment",
        assetId: ASSET_ID,
        assetChecksum: SOURCE_CHECKSUM,
        projectMediaPath: "media/visuals/asset-photo/v1.png"
      }
    ]);
    const mediaEntries = await fs.readdir(path.dirname(destination));
    expect(mediaEntries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["processing", "inactive", "error"] as const)(
    "rejects %s assets before changing project files",
    async (status) => {
      const context = await setup({ asset: createAsset({ status }) });
      const before = await fs.readFile(context.projectFile);

      await expectError(
        () =>
          context.service.assign(PROJECT_ID, {
            expectedRevision: 0,
            assignment: createAssignment()
          }),
        VISUAL_ASSIGNMENT_ERROR_CODE.assetNotActive
      );

      expect(await fs.readFile(context.projectFile)).toEqual(before);
      await expect(
        fs.access(await finalPath(context.projectRoot))
      ).rejects.toThrow();
    }
  );

  it("rejects a missing asset, an unconfirmed checksum, sound effects, and kind mismatches", async () => {
    const missing = await setup({ asset: undefined });
    const missingService = new VisualAssignmentService({
      repository: missing.repository,
      assetRepository: { findAssetDetail: () => undefined },
      workspaceRoot: missing.workspaceRoot,
      libraryRoot: missing.libraryRoot,
      createId: () => "temp-file-id"
    });
    await expectError(
      () =>
        missingService.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound
    );

    const noChecksum = await setup({ asset: createAsset({ checksum: null }) });
    await expectError(
      () =>
        noChecksum.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.assetChecksumUnavailable
    );

    const soundEffect = await setup({
      asset: createAsset({ kind: "sound_effect" }),
      bytes: Buffer.from("RIFF" + "0".repeat(40), "latin1")
    });
    await expectError(
      () =>
        soundEffect.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.assetKindUnsupported
    );

    const mismatch = await setup();
    await expectError(
      () =>
        mismatch.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment(
            "mismatched-kind",
            ASSET_ID,
            clone(videoProjectFixture.visuals.assignments[2].display)
          )
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.displayKindMismatch
    );
  });

  it("rejects duplicate assignment IDs without changing the existing project", async () => {
    const context = await setup();
    const current = await readProject(context.projectFile);
    current.visuals.assignments.push({
      ...createAssignment(),
      assetChecksum: SOURCE_CHECKSUM,
      projectMediaPath: "media/visuals/asset-photo/v1.png"
    });
    await fs.writeFile(
      context.projectFile,
      `${JSON.stringify(videoProjectSchema.parse(current), null, 2)}\n`
    );
    const before = await fs.readFile(context.projectFile);

    await expectError(
      () =>
        context.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdConflict
    );
    expect(await fs.readFile(context.projectFile)).toEqual(before);
  });

  it("removes a partially copied temporary file when copy fails", async () => {
    const context = await setup({
      fileSystem: {
        copyFile: async (sourcePath, destinationPath) => {
          await fs.copyFile(sourcePath, destinationPath);
          throw new Error("injected copy failure");
        }
      }
    });

    await expectError(
      () =>
        context.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.copyFailed
    );
    const destinationDirectory = path.dirname(
      await finalPath(context.projectRoot)
    );
    expect(
      (await fs.readdir(destinationDirectory)).filter((entry) =>
        entry.endsWith(".tmp")
      )
    ).toEqual([]);
    await expect(
      fs.access(await finalPath(context.projectRoot))
    ).rejects.toThrow();
  });

  it("removes the temporary file when the copied checksum does not match", async () => {
    const context = await setup({
      asset: createAsset({ checksum: "f".repeat(64) })
    });

    await expectError(
      () =>
        context.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.checksumMismatch
    );
    const destinationDirectory = path.dirname(
      await finalPath(context.projectRoot)
    );
    expect(
      (await fs.readdir(destinationDirectory)).filter((entry) =>
        entry.endsWith(".tmp")
      )
    ).toEqual([]);
    await expect(
      fs.access(await finalPath(context.projectRoot))
    ).rejects.toThrow();
  });

  it("rolls back the newly placed file on revision conflict", async () => {
    const context = await setup();
    const repository: Pick<ProjectRepository, "read" | "save"> = {
      read: context.repository.read.bind(context.repository),
      save: async () => {
        throw new ProjectRepositoryError(
          "PROJECT_REVISION_CONFLICT",
          409,
          "The project revision does not match the expected revision."
        );
      }
    };
    const service = new VisualAssignmentService({
      repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "temp-file-id"
    });

    await expectError(
      () =>
        service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      "PROJECT_REVISION_CONFLICT"
    );
    await expect(
      fs.access(await finalPath(context.projectRoot))
    ).rejects.toThrow();
  });

  it.each(["write", "rename"] as const)(
    "rolls back the newly placed file when project %s fails",
    async (failurePoint) => {
      const context = await setup();
      const repository = new ProjectRepository({
        workspaceRoot: context.workspaceRoot,
        fileSystem:
          failurePoint === "write"
            ? {
                writeFile: async () => {
                  throw new Error("injected write failure");
                }
              }
            : {
                rename: async (_sourcePath, destinationPath) => {
                  if (destinationPath.endsWith("project.json")) {
                    throw new Error("injected rename failure");
                  }
                  throw new Error("unexpected rename");
                }
              }
      });
      const before = await fs.readFile(context.projectFile);
      const service = new VisualAssignmentService({
        repository,
        assetRepository: { findAssetDetail: () => context.asset },
        workspaceRoot: context.workspaceRoot,
        libraryRoot: context.libraryRoot,
        createId: () => "temp-file-id"
      });

      await expectError(
        () =>
          service.assign(PROJECT_ID, {
            expectedRevision: 0,
            assignment: createAssignment()
          }),
        failurePoint === "write"
          ? "PROJECT_WRITE_FAILED"
          : "PROJECT_RENAME_FAILED"
      );
      expect(await fs.readFile(context.projectFile)).toEqual(before);
      await expect(
        fs.access(await finalPath(context.projectRoot))
      ).rejects.toThrow();
    }
  );

  it("reuses an existing matching file and does not delete it after JSON save failure", async () => {
    const context = await setup();
    const destination = await finalPath(context.projectRoot);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, context.bytes);
    const repository: Pick<ProjectRepository, "read" | "save"> = {
      read: context.repository.read.bind(context.repository),
      save: async () => {
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    };
    const service = new VisualAssignmentService({
      repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "temp-file-id"
    });

    await expectError(
      () =>
        service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      "PROJECT_WRITE_FAILED"
    );
    expect(await fs.readFile(destination)).toEqual(context.bytes);
  });

  it("reports cleanup failure and keeps the newly placed file when compensation cannot unlink it", async () => {
    const context = await setup();
    const repository: Pick<ProjectRepository, "read" | "save"> = {
      read: context.repository.read.bind(context.repository),
      save: async () => {
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    };
    const destination = await finalPath(context.projectRoot);
    const service = new VisualAssignmentService({
      repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      fileSystem: {
        unlink: async (filePath) => {
          if (filePath === destination) {
            throw new Error("injected cleanup failure");
          }
          await fs.unlink(filePath);
        }
      },
      createId: () => "temp-file-id"
    });

    await expectError(
      () =>
        service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed
    );
    expect(await fs.readFile(destination)).toEqual(context.bytes);
  });

  it("does not overwrite a different existing final file", async () => {
    const context = await setup();
    const destination = await finalPath(context.projectRoot);
    const existingBytes = Buffer.from("pre-existing content", "utf8");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, existingBytes);

    await expectError(
      () =>
        context.service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict
    );
    expect(await fs.readFile(destination)).toEqual(existingBytes);
  });

  it("protects a final file referenced by another assignment during cleanup", async () => {
    const context = await setup();
    const repository: Pick<ProjectRepository, "read" | "save"> = {
      read: context.repository.read.bind(context.repository),
      save: async (projectId, _candidate, expectedRevision) => {
        const current = await context.repository.read(projectId);
        const referenced = {
          ...current,
          visuals: {
            ...current.visuals,
            assignments: [
              ...current.visuals.assignments,
              {
                ...createAssignment("other-assignment"),
                assetChecksum: SOURCE_CHECKSUM,
                projectMediaPath: "media/visuals/asset-photo/v1.png"
              }
            ]
          }
        };
        await context.repository.save(projectId, referenced, expectedRevision);
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    };
    const service = new VisualAssignmentService({
      repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "temp-file-id"
    });

    await expectError(
      () =>
        service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      "PROJECT_WRITE_FAILED"
    );
    expect(await fs.readFile(await finalPath(context.projectRoot))).toEqual(
      context.bytes
    );
  });

  it.each(["../outside.png", "C:/outside.png"])(
    "rejects unsafe library path %s",
    async (libraryMediaPath) => {
      const context = await setup();
      context.asset.libraryMediaPath = libraryMediaPath;
      const before = await fs.readFile(context.projectFile);

      await expectError(
        () =>
          context.service.assign(PROJECT_ID, {
            expectedRevision: 0,
            assignment: createAssignment()
          }),
        VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid
      );
      expect(await fs.readFile(context.projectFile)).toEqual(before);
    }
  );

  it("rejects a library path that resolves outside the management root", async () => {
    const context = await setup();
    const sourcePath = path.join(
      context.libraryRoot,
      context.asset.libraryMediaPath
    );
    const outsidePath = path.join(context.workspaceRoot, "outside.png");
    await fs.writeFile(outsidePath, context.bytes);
    const service = new VisualAssignmentService({
      repository: context.repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      fileSystem: {
        realpath: async (candidatePath) =>
          candidatePath === sourcePath
            ? outsidePath
            : fs.realpath(candidatePath)
      },
      createId: () => "temp-file-id"
    });

    await expectError(
      () =>
        service.assign(PROJECT_ID, {
          expectedRevision: 0,
          assignment: createAssignment()
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid
    );
    await expect(
      fs.access(await finalPath(context.projectRoot))
    ).rejects.toThrow();
  });
});
