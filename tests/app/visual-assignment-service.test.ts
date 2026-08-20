import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AssetRepository } from "../../src/app/assets/asset-repository.js";
import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryLockedOperations
} from "../../src/app/projects/project-repository.js";
import {
  VISUAL_ASSIGNMENT_ERROR_CODE,
  VisualAssignmentError
} from "../../src/app/projects/visual-assignment-errors.js";
import { VisualAssignmentService } from "../../src/app/projects/visual-assignment-service.js";
import { ImprovementLogRepository } from "../../src/app/projects/improvement-log-repository.js";
import type { VisualAssignmentFileSystem } from "../../src/app/projects/visual-assignment-file-system.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
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

type RepositoryPort = Pick<
  ProjectRepository,
  "read" | "save" | "withProjectLock"
>;

type RepositorySave = (
  projectId: unknown,
  candidate: unknown,
  expectedRevision: unknown,
  lockedRepository?: ProjectRepositoryLockedOperations
) => Promise<VideoProject>;

function createRepositoryDouble(
  repository: ProjectRepository,
  save: RepositorySave
): RepositoryPort {
  const read = repository.read.bind(repository);
  const saveWithProjectId: RepositorySave = (
    projectId,
    candidate,
    expectedRevision,
    lockedRepository
  ) => save(projectId, candidate, expectedRevision, lockedRepository);

  return {
    read,
    save: saveWithProjectId,
    withProjectLock: <T>(
      projectId: unknown,
      operation: (
        lockedRepository: ProjectRepositoryLockedOperations
      ) => Promise<T>
    ) =>
      repository.withProjectLock(projectId, (lockedRepository) =>
        operation({
          read: lockedRepository.read,
          save: (candidate, expectedRevision) =>
            saveWithProjectId(
              projectId,
              candidate,
              expectedRevision,
              lockedRepository
            )
        })
      )
  };
}

type SetupOptions = {
  readonly asset?: AssetDetail | undefined;
  readonly bytes?: Uint8Array;
  readonly fileSystem?: Partial<VisualAssignmentFileSystem>;
  readonly repository?: RepositoryPort;
};

describe("VisualAssignmentService", () => {
  const roots: string[] = [];
  const databases: Array<
    Awaited<ReturnType<typeof initializeWorkspaceDatabase>>
  > = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close();
    }
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
    project.script.status = "draft";
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

  it("records an accepted AI candidate using server-owned asset and assignment data", async () => {
    const context = await setup();
    const database = await initializeWorkspaceDatabase({
      workspaceRoot: context.workspaceRoot
    });
    databases.push(database);
    const log = new ImprovementLogRepository(database.database);
    const service = new VisualAssignmentService({
      repository: context.repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "temp-file-id",
      improvementLogRepository: log
    });
    await context.repository.save(
      PROJECT_ID,
      {
        ...(await context.repository.read(PROJECT_ID)),
        visuals: {
          ...(await context.repository.read(PROJECT_ID)).visuals,
          suggestionRunIds: ["visual-run"]
        }
      },
      0
    );
    await log.insertGenerationCandidate({
      candidateId: "visual-run-candidate-asset-photo",
      generationRunId: "visual-run",
      projectId: PROJECT_ID,
      projectRevision: 1,
      taskKind: "visual_search_intent",
      targetKind: "visual_line_range",
      targetId: "main-mentor-1:main-learner-1",
      candidateKey: "asset:asset-photo",
      candidate: {
        asset: {
          assetId: context.asset.assetId,
          version: context.asset.version,
          kind: context.asset.kind,
          title: context.asset.title,
          description: context.asset.description,
          confidentiality: context.asset.confidentiality,
          department: context.asset.department,
          system: context.asset.system,
          mimeType: context.asset.mimeType,
          checksum: context.asset.checksum,
          sizeBytes: context.asset.sizeBytes,
          width: context.asset.width,
          height: context.asset.height,
          durationMs: context.asset.durationMs,
          pageCount: context.asset.pageCount,
          thumbnailPaths: context.asset.thumbnailPaths,
          tags: [],
          tagIds: [],
          status: context.asset.status,
          errorCode: context.asset.errorCode,
          errorMessage: context.asset.errorMessage,
          createdAt: context.asset.createdAt,
          updatedAt: context.asset.updatedAt
        },
        matchedRequiredTags: [],
        matchedOptionalTags: [],
        matchReasons: ["fixture match"]
      },
      modelId: "visual-model",
      responseModel: null,
      promptVersion: "1.0.0",
      createdAt: NOW
    });

    const result = await service.assign(PROJECT_ID, {
      expectedRevision: 1,
      suggestionRunId: "visual-run",
      reason: "   ",
      assignment: createAssignment()
    });
    const decisions = await log.listDecisions(PROJECT_ID);

    expect(result.revision).toBe(2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: "accepted",
      reason: null,
      afterJson: expect.objectContaining({ assetId: ASSET_ID }),
      modelId: "visual-model",
      promptVersion: "1.0.0"
    });
  });

  it("serializes placement and compensation with other project saves", async () => {
    const context = await setup();
    let releaseCopy!: () => void;
    let copyStartedResolve!: () => void;
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const copyStarted = new Promise<void>((resolve) => {
      copyStartedResolve = resolve;
    });
    let copyCalls = 0;
    const fileSystem: Partial<VisualAssignmentFileSystem> = {
      copyFile: async (sourcePath, destinationPath) => {
        copyCalls += 1;
        copyStartedResolve();
        await copyGate;
        await fs.copyFile(sourcePath, destinationPath);
      }
    };
    const createService = () =>
      new VisualAssignmentService({
        repository: context.repository,
        assetRepository: { findAssetDetail: () => context.asset },
        workspaceRoot: context.workspaceRoot,
        libraryRoot: context.libraryRoot,
        fileSystem,
        createId: () => `temp-file-id-${copyCalls}`
      });

    const firstAssignment = createService().assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment("first-assignment")
    });
    await copyStarted;

    const secondAssignment = createService()
      .assign(PROJECT_ID, {
        expectedRevision: 0,
        assignment: createAssignment("second-assignment")
      })
      .catch((error: unknown) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(copyCalls).toBe(1);

    releaseCopy();
    await expect(firstAssignment).resolves.toMatchObject({ revision: 1 });
    await expect(secondAssignment).resolves.toMatchObject({
      code: "PROJECT_REVISION_CONFLICT"
    });
    expect(copyCalls).toBe(1);
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

  it("fills explicit defaults for photo, video, and document assignments", async () => {
    const withoutDisplay = () => {
      const { display, ...assignment } = createAssignment();
      void display;
      return assignment;
    };

    const photo = await setup();
    const photoResult = await photo.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: withoutDisplay()
    });
    expect(photoResult.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "photo",
      fit: "contain",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      position: { x: 0.5, y: 0.5 },
      prioritizeVisual: false,
      annotations: []
    });

    const video = await setup({
      asset: createAsset({
        kind: "video",
        durationMs: 1200,
        pageCount: null
      })
    });
    const videoResult = await video.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: withoutDisplay()
    });
    expect(videoResult.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      startMs: 0,
      endMs: 1200,
      playbackRate: 1,
      volume: 0
    });

    const document = await setup({
      asset: createAsset({
        kind: "document_scan",
        durationMs: null,
        pageCount: 2
      })
    });
    const documentResult = await document.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: withoutDisplay()
    });
    expect(documentResult.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "document_scan",
      page: 1
    });
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
    const repository = createRepositoryDouble(
      context.repository as ProjectRepository,
      async () => {
        throw new ProjectRepositoryError(
          "PROJECT_REVISION_CONFLICT",
          409,
          "The project revision does not match the expected revision."
        );
      }
    );
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
    const repository = createRepositoryDouble(
      context.repository as ProjectRepository,
      async () => {
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    );
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
    const repository = createRepositoryDouble(
      context.repository as ProjectRepository,
      async () => {
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    );
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

  it("does not replace a file created after the initial final-path check", async () => {
    const context = await setup();
    const destination = await finalPath(context.projectRoot);
    const competingBytes = Buffer.from(
      "created by a competing request",
      "utf8"
    );
    let firstFinalPathProbe = true;
    const service = new VisualAssignmentService({
      repository: context.repository,
      assetRepository: { findAssetDetail: () => context.asset },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      fileSystem: {
        pathExists: async (filePath) => {
          if (filePath === destination && firstFinalPathProbe) {
            firstFinalPathProbe = false;
            return false;
          }
          try {
            await fs.access(filePath);
            return true;
          } catch {
            return false;
          }
        },
        rename: async (_sourcePath, destinationPath) => {
          await fs.writeFile(destinationPath, competingBytes);
          throw Object.assign(new Error("destination exists"), {
            code: "EEXIST"
          });
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
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict
    );
    expect(await fs.readFile(destination)).toEqual(competingBytes);
    expect(
      (await fs.readdir(path.dirname(destination))).filter((entry) =>
        entry.endsWith(".tmp")
      )
    ).toEqual([]);
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
    const repository = createRepositoryDouble(
      context.repository as ProjectRepository,
      async (_projectId, _candidate, expectedRevision, lockedRepository) => {
        if (lockedRepository === undefined) {
          throw new Error("locked repository is required");
        }
        const current = await lockedRepository.read();
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
        await lockedRepository.save(referenced, expectedRevision);
        throw new ProjectRepositoryError(
          "PROJECT_WRITE_FAILED",
          500,
          "The project could not be saved."
        );
      }
    );
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

  it("updates and removes an assignment without deleting the imported file", async () => {
    const context = await setup();
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    const assignment = assigned.data.visuals.assignments[0];
    if (assignment === undefined) {
      throw new Error("assignment was not created");
    }

    const updated = await context.service.update(PROJECT_ID, assignment.id, {
      expectedRevision: assigned.revision,
      assignment: {
        id: assignment.id,
        startLineId: assignment.startLineId,
        endLineId: assignment.endLineId,
        assetId: assignment.assetId,
        display: {
          ...assignment.display,
          prioritizeVisual: true,
          crop: { ...assignment.display.crop, x: 0.1, width: 0.9 }
        }
      }
    });
    expect(updated.revision).toBe(2);
    expect(updated.data.visuals.status).toBe("needs_review");
    expect(updated.data.visuals.assignments[0]?.display.prioritizeVisual).toBe(
      true
    );

    const destination = await finalPath(context.projectRoot);
    const beforeRemove = await fs.readFile(destination);
    const removed = await context.service.remove(PROJECT_ID, assignment.id, {
      expectedRevision: updated.revision
    });
    expect(removed.revision).toBe(3);
    expect(removed.data.visuals.assignments).toEqual([]);
    expect(await fs.readFile(destination)).toEqual(beforeRemove);
  });

  it("saves video pause/resume cues and rejects range shortening without deleting them", async () => {
    const context = await setup({
      asset: createAsset({
        kind: "video",
        durationMs: 1000,
        libraryMediaPath: `media/${ASSET_ID}/v1.mp4`
      })
    });
    const videoDisplay = {
      ...clone(videoProjectFixture.visuals.assignments[0].display),
      endMs: 1000
    };
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment(
        "new-visual-assignment",
        ASSET_ID,
        videoDisplay
      )
    });
    const savedAssignment = assigned.data.visuals.assignments[0];
    if (
      savedAssignment === undefined ||
      savedAssignment.display.kind !== "video"
    ) {
      throw new Error("video assignment was not created");
    }

    const updated = await context.service.update(
      PROJECT_ID,
      savedAssignment.id,
      {
        expectedRevision: assigned.revision,
        assignment: {
          id: savedAssignment.id,
          startLineId: "main-mentor-1",
          endLineId: "main-learner-1",
          assetId: savedAssignment.assetId,
          display: {
            ...savedAssignment.display,
            playbackCues: [
              { lineId: "main-learner-1", edge: "after", action: "resume" },
              { lineId: "main-mentor-1", edge: "after", action: "pause" }
            ]
          }
        }
      }
    );
    expect(updated.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      playbackCues: [
        { lineId: "main-learner-1", edge: "after", action: "resume" },
        { lineId: "main-mentor-1", edge: "after", action: "pause" }
      ]
    });

    const beforeInvalidUpdate = await fs.readFile(context.projectFile);
    const invalid = await expectError(
      () =>
        context.service.update(PROJECT_ID, savedAssignment.id, {
          expectedRevision: updated.revision,
          assignment: {
            id: savedAssignment.id,
            startLineId: "main-mentor-1",
            endLineId: "main-mentor-1",
            assetId: savedAssignment.assetId,
            display: {
              ...updated.data.visuals.assignments[0]!.display,
              playbackCues:
                updated.data.visuals.assignments[0]!.display.kind === "video"
                  ? updated.data.visuals.assignments[0]!.display.playbackCues
                  : []
            }
          }
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid
    );
    expect((invalid as VisualAssignmentError).details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "playback cue line must stay inside the visual assignment range"
        })
      ])
    );
    expect(await fs.readFile(context.projectFile)).toEqual(beforeInvalidUpdate);

    const removedCues = await context.service.update(
      PROJECT_ID,
      savedAssignment.id,
      {
        expectedRevision: updated.revision,
        assignment: {
          id: savedAssignment.id,
          startLineId: "main-mentor-1",
          endLineId: "main-mentor-1",
          assetId: savedAssignment.assetId,
          display: {
            ...updated.data.visuals.assignments[0]!.display,
            playbackCues: []
          }
        }
      }
    );
    expect(removedCues.revision).toBe(updated.revision + 1);
    expect(removedCues.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      playbackCues: []
    });
  });

  it("updates cue-only assignment snapshots without requiring a live active asset", async () => {
    const context = await setup({
      asset: createAsset({
        kind: "video",
        durationMs: 1000,
        libraryMediaPath: `media/${ASSET_ID}/v1.mp4`
      })
    });
    const videoDisplay = {
      ...clone(videoProjectFixture.visuals.assignments[0].display),
      endMs: 1000
    };
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment(
        "snapshot-video-assignment",
        ASSET_ID,
        videoDisplay
      )
    });
    const assignment = assigned.data.visuals.assignments[0];
    if (assignment === undefined || assignment.display.kind !== "video") {
      throw new Error("video assignment was not created");
    }

    const withCue = await context.service.update(PROJECT_ID, assignment.id, {
      expectedRevision: assigned.revision,
      assignment: {
        id: assignment.id,
        startLineId: assignment.startLineId,
        endLineId: assignment.endLineId,
        assetId: assignment.assetId,
        display: {
          ...assignment.display,
          playbackCues: [
            { lineId: "main-mentor-1", edge: "after", action: "pause" }
          ]
        }
      }
    });

    const liveAssetAfterReplacement = {
      ...context.asset,
      checksum: "b".repeat(64),
      status: "inactive" as const
    };
    const snapshotService = new VisualAssignmentService({
      repository: context.repository,
      assetRepository: {
        findAssetDetail: () => liveAssetAfterReplacement
      },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "temp-file-id"
    });

    const withoutCue = await snapshotService.update(PROJECT_ID, assignment.id, {
      expectedRevision: withCue.revision,
      assignment: {
        id: assignment.id,
        startLineId: assignment.startLineId,
        endLineId: assignment.endLineId,
        assetId: assignment.assetId,
        display: {
          ...withCue.data.visuals.assignments[0]!.display,
          playbackCues: []
        }
      }
    });

    expect(withoutCue.revision).toBe(withCue.revision + 1);
    expect(withoutCue.data.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      playbackCues: []
    });
  });

  it("does not reinterpret a legacy assignment in a regular update", async () => {
    const context = await setup();
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    const assignment = assigned.data.visuals.assignments[0];
    if (assignment === undefined) {
      throw new Error("assignment was not created");
    }

    const legacyProject = clone(assigned.data);
    const legacyAssignment = legacyProject.visuals.assignments[0];
    if (legacyAssignment === undefined) {
      throw new Error("legacy assignment was not created");
    }
    legacyAssignment.display.displayCoordinateSpace = "legacy-media-frame";
    const savedLegacyProject = await context.repository.save(
      PROJECT_ID,
      legacyProject,
      assigned.revision
    );
    const before = await fs.readFile(context.projectFile);

    const error = await expectError(
      () =>
        context.service.update(PROJECT_ID, assignment.id, {
          expectedRevision: savedLegacyProject.revision,
          assignment: {
            id: assignment.id,
            startLineId: assignment.startLineId,
            endLineId: assignment.endLineId,
            assetId: assignment.assetId,
            display: {
              ...legacyAssignment.display,
              displayCoordinateSpace: "content-slot-relative"
            }
          }
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid
    );

    expect((error as VisualAssignmentError).details).toEqual([
      {
        path: ["assignment", "display", "displayCoordinateSpace"],
        message:
          "display coordinate space cannot be changed by a regular update"
      }
    ]);
    expect(await fs.readFile(context.projectFile)).toEqual(before);
    expect((await readProject(context.projectFile)).revision).toBe(
      savedLegacyProject.revision
    );
  });

  it("rejects stale, missing, and mismatched assignment updates", async () => {
    const context = await setup();
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    const assignment = assigned.data.visuals.assignments[0];
    if (assignment === undefined) {
      throw new Error("assignment was not created");
    }
    const input = {
      expectedRevision: assigned.revision,
      assignment: {
        id: assignment.id,
        startLineId: assignment.startLineId,
        endLineId: assignment.endLineId,
        assetId: assignment.assetId,
        display: assignment.display
      }
    };

    await expectError(
      () =>
        context.service.update(PROJECT_ID, assignment.id, {
          ...input,
          expectedRevision: 0
        }),
      "PROJECT_REVISION_CONFLICT"
    );
    await expectError(
      () =>
        context.service.update(PROJECT_ID, "missing-assignment", {
          ...input,
          assignment: { ...input.assignment, id: "missing-assignment" }
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound
    );
    await expectError(
      () => context.service.update(PROJECT_ID, "other-assignment", input),
      VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdMismatch
    );
  });

  it("revalidates imported files and approves a valid visual plan", async () => {
    const context = await setup();
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });

    const approved = await context.service.approve(PROJECT_ID, {
      expectedRevision: assigned.revision
    });
    expect(approved.revision).toBe(2);
    expect(approved.data.visuals.status).toBe("approved");
    expect((await readProject(context.projectFile)).visuals.status).toBe(
      "approved"
    );
  });

  it("leaves the project unchanged when the imported checksum is invalid", async () => {
    const context = await setup();
    const assigned = await context.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    await fs.writeFile(
      await finalPath(context.projectRoot),
      Buffer.from("changed after assignment", "utf8")
    );
    const before = await fs.readFile(context.projectFile);

    await expectError(
      () =>
        context.service.approve(PROJECT_ID, {
          expectedRevision: assigned.revision
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaChecksumMismatch
    );
    expect(await fs.readFile(context.projectFile)).toEqual(before);
  });

  it("rejects a missing imported file and missing confidentiality at approval", async () => {
    const missingFile = await setup();
    const missingFileAssignment = await missingFile.service.assign(PROJECT_ID, {
      expectedRevision: 0,
      assignment: createAssignment()
    });
    await fs.rm(await finalPath(missingFile.projectRoot));
    const beforeMissingFile = await fs.readFile(missingFile.projectFile);
    await expectError(
      () =>
        missingFile.service.approve(PROJECT_ID, {
          expectedRevision: missingFileAssignment.revision
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaFileMissing
    );
    expect(await fs.readFile(missingFile.projectFile)).toEqual(
      beforeMissingFile
    );

    const missingConfidentiality = await setup({
      asset: createAsset({ confidentiality: "" })
    });
    const missingConfidentialityAssignment =
      await missingConfidentiality.service.assign(PROJECT_ID, {
        expectedRevision: 0,
        assignment: createAssignment()
      });
    await expectError(
      () =>
        missingConfidentiality.service.approve(PROJECT_ID, {
          expectedRevision: missingConfidentialityAssignment.revision
        }),
      VISUAL_ASSIGNMENT_ERROR_CODE.approvalValidationFailed
    );
  });

  it.each([
    ["video duration", "video", 1000, undefined],
    ["document page", "document_scan", undefined, 1]
  ] as const)(
    "rejects display settings outside %s metadata",
    async (_label, kind, durationMs, pageCount) => {
      const context = await setup({
        asset: createAsset({
          kind,
          durationMs: durationMs ?? null,
          pageCount: pageCount ?? null
        })
      });
      const display =
        kind === "video"
          ? clone(videoProjectFixture.visuals.assignments[0].display)
          : clone(videoProjectFixture.visuals.assignments[2].display);
      if (display.kind === "video") {
        display.endMs = 1001;
      } else if (display.kind === "document_scan") {
        display.page = 2;
      }

      await expectError(
        () =>
          context.service.assign(PROJECT_ID, {
            expectedRevision: 0,
            assignment: createAssignment("out-of-bounds", ASSET_ID, display)
          }),
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid
      );
    }
  );
});
