import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryLockedOperations
} from "../../src/app/projects/project-repository.js";
import {
  PROJECT_EDIT_ERROR_CODE,
  ProjectEditError
} from "../../src/app/projects/project-edit-errors.js";
import { ProjectEditService } from "../../src/app/projects/project-edit-service.js";
import type { VisualAssignmentFileSystem } from "../../src/app/projects/visual-assignment-file-system.js";
import {
  assetDetailSchema,
  relativePosixPathSchema,
  videoProjectSchema,
  type AssetDetail,
  type VideoProject
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const NOW = "2026-08-16T00:00:00.000Z";
const PROJECT_ID = "project-edit-service";

type AssetFixture = {
  readonly asset: AssetDetail;
  readonly bytes: Uint8Array;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createAssetFixture(
  assetId: string,
  kind: "video" | "bgm",
  bytes: Uint8Array,
  overrides: Partial<AssetDetail> = {}
): AssetFixture {
  const extension = kind === "video" ? "mp4" : "mp3";
  const { libraryMediaPath: overriddenLibraryPath, ...safeOverrides } =
    overrides;
  const parsedAsset = assetDetailSchema.parse({
    assetId,
    version: 1,
    kind,
    title: assetId,
    description: "",
    confidentiality: "internal",
    department: null,
    system: null,
    mimeType: kind === "video" ? "video/mp4" : "audio/mpeg",
    libraryMediaPath: `media/${assetId}/v1.${extension}`,
    checksum: checksum(bytes),
    sizeBytes: bytes.length,
    width: kind === "video" ? 1920 : null,
    height: kind === "video" ? 1080 : null,
    durationMs: 1000,
    pageCount: null,
    thumbnailPaths: [],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...safeOverrides
  });
  const asset =
    overriddenLibraryPath === undefined
      ? parsedAsset
      : ({
          ...parsedAsset,
          libraryMediaPath: overriddenLibraryPath
        } as AssetDetail);
  return { asset, bytes };
}

type SetupOptions = {
  readonly assets?: readonly AssetFixture[];
  readonly fileSystem?: Partial<VisualAssignmentFileSystem>;
};

type SetupContext = {
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly libraryRoot: string;
  readonly projectFile: string;
  readonly repository: ProjectRepository;
  readonly assets: Map<string, AssetDetail>;
  readonly service: ProjectEditService;
};

const defaultVideo = () =>
  createAssetFixture(
    "asset-video",
    "video",
    Buffer.from("mp4 fixture bytes", "utf8")
  );
const defaultBgm = () =>
  createAssetFixture(
    "asset-bgm",
    "bgm",
    Buffer.from("mp3 fixture bytes", "utf8")
  );

describe("ProjectEditService", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function setup(options: SetupOptions = {}): Promise<SetupContext> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-edit-")
    );
    roots.push(workspaceRoot);
    const projectRoot = path.join(workspaceRoot, "projects", PROJECT_ID);
    const libraryRoot = path.join(workspaceRoot, "library");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(libraryRoot, { recursive: true });

    const project = clone(videoProjectFixture) as VideoProject;
    project.metadata.id = PROJECT_ID;
    project.metadata.updatedAt = NOW;
    project.revision = 0;
    project.edit = { videoElements: [], sectionBgms: [] };
    videoProjectSchema.parse(project);
    const projectFile = path.join(projectRoot, "project.json");
    await fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);

    const assets = new Map(
      (options.assets ?? []).map(({ asset }) => [asset.assetId, asset])
    );
    for (const fixture of options.assets ?? []) {
      const pathResult = relativePosixPathSchema.safeParse(
        fixture.asset.libraryMediaPath
      );
      if (!pathResult.success) {
        continue;
      }
      const sourcePath = path.join(
        libraryRoot,
        pathResult.data.split("/").join(path.sep)
      );
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, fixture.bytes);
    }

    const repository = new ProjectRepository({
      workspaceRoot,
      now: () => new Date(NOW)
    });
    const service = new ProjectEditService({
      repository,
      assetRepository: {
        findAssetDetail: (assetId) => assets.get(assetId)
      },
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
      repository,
      assets,
      service
    };
  }

  function videoInput(assetId = "asset-video", id = "intro-video") {
    return {
      id,
      role: "intro" as const,
      assetId,
      placement: { kind: "before_first_section" as const },
      volume: 0.4
    };
  }

  function bgmInput(assetId = "asset-bgm", id = "main-bgm") {
    return {
      id,
      sectionId: "section-main",
      assetId,
      volume: 0.25
    };
  }

  function request(
    edit: {
      videoElements: ReturnType<typeof videoInput>[];
      sectionBgms: ReturnType<typeof bgmInput>[];
    },
    expectedRevision = 0
  ) {
    return { edit, expectedRevision };
  }

  async function readProject(projectFile: string): Promise<VideoProject> {
    return videoProjectSchema.parse(
      JSON.parse(await fs.readFile(projectFile, "utf8"))
    );
  }

  async function expectCode(
    operation: () => Promise<unknown>,
    code: string
  ): Promise<ProjectEditError | ProjectRepositoryError> {
    const error = await operation().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(code);
    return error as ProjectEditError | ProjectRepositoryError;
  }

  async function expectMissing(filePath: string): Promise<void> {
    await expect(fs.access(filePath)).rejects.toThrow();
  }

  function actualFinalPath(
    projectRoot: string,
    kind: "video" | "bgm",
    assetId: string
  ): string {
    return path.join(
      projectRoot,
      kind === "video" ? "media" : "audio",
      kind === "video" ? "edits" : "bgm",
      assetId,
      `v1.${kind === "video" ? "mp4" : "mp3"}`
    );
  }

  function failingSaveRepository(
    repository: ProjectRepository
  ): Pick<ProjectRepository, "withProjectLock"> {
    return {
      withProjectLock: <T>(
        projectId: unknown,
        operation: (
          lockedRepository: ProjectRepositoryLockedOperations
        ) => Promise<T>
      ) =>
        repository.withProjectLock(projectId, (lockedRepository) =>
          operation({
            read: lockedRepository.read,
            save: async () => {
              throw new ProjectRepositoryError(
                "PROJECT_WRITE_FAILED",
                500,
                "The project could not be saved."
              );
            }
          })
        )
    };
  }

  it("copies MP4 and MP3 assets and persists backend-owned snapshots", async () => {
    const video = defaultVideo();
    const bgm = defaultBgm();
    const context = await setup({ assets: [video, bgm] });

    const result = await context.service.save(
      PROJECT_ID,
      request({
        videoElements: [videoInput()],
        sectionBgms: [bgmInput()]
      })
    );
    const savedVideo = result.data.edit.videoElements[0];
    const savedBgm = result.data.edit.sectionBgms[0];

    expect(result.revision).toBe(1);
    expect(savedVideo).toMatchObject({
      id: "intro-video",
      assetId: "asset-video",
      assetVersion: 1,
      assetChecksum: video.asset.checksum,
      projectMediaPath: "media/edits/asset-video/v1.mp4"
    });
    expect(savedBgm).toMatchObject({
      id: "main-bgm",
      assetId: "asset-bgm",
      assetVersion: 1,
      assetChecksum: bgm.asset.checksum,
      projectMediaPath: "audio/bgm/asset-bgm/v1.mp3"
    });
    expect(
      await fs.readFile(
        actualFinalPath(context.projectRoot, "video", "asset-video")
      )
    ).toEqual(video.bytes);
    expect(
      await fs.readFile(
        actualFinalPath(context.projectRoot, "bgm", "asset-bgm")
      )
    ).toEqual(bgm.bytes);
    expect((await context.service.read(PROJECT_ID)).data).toEqual(
      result.data.edit
    );
    expect(await readProject(context.projectFile)).toEqual(result.data);
  });

  it.each([
    [
      "processing asset",
      "asset-not-active",
      "processing",
      PROJECT_EDIT_ERROR_CODE.assetNotActive
    ],
    [
      "inactive asset",
      "asset-inactive",
      "inactive",
      PROJECT_EDIT_ERROR_CODE.assetNotActive
    ],
    [
      "error asset",
      "asset-error",
      "error",
      PROJECT_EDIT_ERROR_CODE.assetNotActive
    ]
  ] as const)(
    "rejects an %s before changing the project",
    async (_label, assetId, status, expectedCode) => {
      const fixture = createAssetFixture(
        assetId,
        "video",
        Buffer.from(`${assetId} bytes`, "utf8"),
        { status }
      );
      const context = await setup({ assets: [fixture] });
      const before = await fs.readFile(context.projectFile);

      await expectCode(
        () =>
          context.service.save(
            PROJECT_ID,
            request({ videoElements: [videoInput(assetId)], sectionBgms: [] })
          ),
        expectedCode
      );

      expect(await fs.readFile(context.projectFile)).toEqual(before);
      await expectMissing(
        actualFinalPath(context.projectRoot, "video", assetId)
      );
    }
  );

  it("rejects missing, wrong-kind, wrong-format, and unconfirmed-checksum assets", async () => {
    const missing = await setup();
    await expectCode(
      () =>
        missing.service.save(
          PROJECT_ID,
          request({
            videoElements: [videoInput("missing-asset")],
            sectionBgms: []
          })
        ),
      PROJECT_EDIT_ERROR_CODE.assetNotFound
    );

    const wrongKind = await setup({ assets: [defaultBgm()] });
    await expectCode(
      () =>
        wrongKind.service.save(
          PROJECT_ID,
          request({ videoElements: [videoInput("asset-bgm")], sectionBgms: [] })
        ),
      PROJECT_EDIT_ERROR_CODE.assetKindMismatch
    );

    const wrongFormat = await setup({
      assets: [
        createAssetFixture(
          "asset-wrong-format",
          "video",
          Buffer.from("wrong format bytes", "utf8"),
          { mimeType: "video/quicktime" }
        )
      ]
    });
    await expectCode(
      () =>
        wrongFormat.service.save(
          PROJECT_ID,
          request({
            videoElements: [videoInput("asset-wrong-format")],
            sectionBgms: []
          })
        ),
      PROJECT_EDIT_ERROR_CODE.assetFormatMismatch
    );

    const noChecksum = await setup({
      assets: [
        createAssetFixture(
          "asset-no-checksum",
          "video",
          Buffer.from("no checksum bytes", "utf8"),
          { checksum: null }
        )
      ]
    });
    await expectCode(
      () =>
        noChecksum.service.save(
          PROJECT_ID,
          request({
            videoElements: [videoInput("asset-no-checksum")],
            sectionBgms: []
          })
        ),
      PROJECT_EDIT_ERROR_CODE.assetChecksumUnavailable
    );
  });

  it("rejects unsafe library paths and copied checksum mismatches without saving", async () => {
    const unsafeAsset = createAssetFixture(
      "asset-unsafe",
      "video",
      Buffer.from("unsafe bytes", "utf8"),
      { libraryMediaPath: "../outside.mp4" }
    );
    const unsafe = await setup({ assets: [unsafeAsset] });
    const beforeUnsafe = await fs.readFile(unsafe.projectFile);
    await expectCode(
      () =>
        unsafe.service.save(
          PROJECT_ID,
          request({
            videoElements: [videoInput("asset-unsafe")],
            sectionBgms: []
          })
        ),
      PROJECT_EDIT_ERROR_CODE.libraryPathInvalid
    );
    expect(await fs.readFile(unsafe.projectFile)).toEqual(beforeUnsafe);

    const bytes = Buffer.from("actual bytes", "utf8");
    const mismatchAsset = createAssetFixture("asset-mismatch", "video", bytes, {
      checksum: "0".repeat(64)
    });
    const mismatch = await setup({ assets: [mismatchAsset] });
    const beforeMismatch = await fs.readFile(mismatch.projectFile);
    await expectCode(
      () =>
        mismatch.service.save(
          PROJECT_ID,
          request({
            videoElements: [videoInput("asset-mismatch")],
            sectionBgms: []
          })
        ),
      PROJECT_EDIT_ERROR_CODE.checksumMismatch
    );
    expect(await fs.readFile(mismatch.projectFile)).toEqual(beforeMismatch);
    await expectMissing(
      actualFinalPath(mismatch.projectRoot, "video", "asset-mismatch")
    );
  });

  it("does not copy when the expected project revision is stale", async () => {
    const context = await setup({ assets: [defaultVideo()] });
    const before = await fs.readFile(context.projectFile);

    await expectCode(
      () =>
        context.service.save(
          PROJECT_ID,
          request({ videoElements: [videoInput()], sectionBgms: [] }, 1)
        ),
      "PROJECT_REVISION_CONFLICT"
    );

    expect(await fs.readFile(context.projectFile)).toEqual(before);
    await expectMissing(
      actualFinalPath(context.projectRoot, "video", "asset-video")
    );
  });

  it("cleans a newly imported replacement when project JSON saving fails and keeps the old reference", async () => {
    const oldAsset = createAssetFixture(
      "asset-old-video",
      "video",
      Buffer.from("old video bytes", "utf8")
    );
    const newAsset = createAssetFixture(
      "asset-new-video",
      "video",
      Buffer.from("new video bytes", "utf8")
    );
    const context = await setup({ assets: [oldAsset, newAsset] });
    const first = await context.service.save(
      PROJECT_ID,
      request({
        videoElements: [videoInput("asset-old-video")],
        sectionBgms: []
      })
    );
    const beforeProject = await fs.readFile(context.projectFile);
    const oldPath = actualFinalPath(
      context.projectRoot,
      "video",
      "asset-old-video"
    );
    const newPath = actualFinalPath(
      context.projectRoot,
      "video",
      "asset-new-video"
    );
    const failingService = new ProjectEditService({
      repository: failingSaveRepository(context.repository),
      assetRepository: {
        findAssetDetail: (assetId) => context.assets.get(assetId)
      },
      workspaceRoot: context.workspaceRoot,
      libraryRoot: context.libraryRoot,
      createId: () => "replacement-temp"
    });

    await expectCode(
      () =>
        failingService.save(
          PROJECT_ID,
          request(
            { videoElements: [videoInput("asset-new-video")], sectionBgms: [] },
            first.revision
          )
        ),
      "PROJECT_WRITE_FAILED"
    );

    expect(await fs.readFile(context.projectFile)).toEqual(beforeProject);
    expect(await fs.readFile(oldPath)).toEqual(oldAsset.bytes);
    await expectMissing(newPath);
  });

  it("does not delete a previously imported file when an edit element is removed", async () => {
    const video = defaultVideo();
    const context = await setup({ assets: [video] });
    const first = await context.service.save(
      PROJECT_ID,
      request({ videoElements: [videoInput()], sectionBgms: [] })
    );
    const importedPath = actualFinalPath(
      context.projectRoot,
      "video",
      "asset-video"
    );

    const removed = await context.service.save(
      PROJECT_ID,
      request({ videoElements: [], sectionBgms: [] }, first.revision)
    );

    expect(removed.data.edit.videoElements).toEqual([]);
    expect(await fs.readFile(importedPath)).toEqual(video.bytes);
  });

  it("does not overwrite different content already occupying the destination", async () => {
    const video = defaultVideo();
    const context = await setup({ assets: [video] });
    const destination = actualFinalPath(
      context.projectRoot,
      "video",
      "asset-video"
    );
    const existingBytes = Buffer.from("existing destination bytes", "utf8");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, existingBytes);

    await expectCode(
      () =>
        context.service.save(
          PROJECT_ID,
          request({ videoElements: [videoInput()], sectionBgms: [] })
        ),
      PROJECT_EDIT_ERROR_CODE.mediaPathConflict
    );

    expect(await fs.readFile(destination)).toEqual(existingBytes);
    expect((await readProject(context.projectFile)).edit.videoElements).toEqual(
      []
    );
  });

  it("reports cleanup failure instead of deleting an uncertain file", async () => {
    const video = defaultVideo();
    const context = await setup({ assets: [video] });
    const destination = actualFinalPath(
      context.projectRoot,
      "video",
      "asset-video"
    );
    const failingService = new ProjectEditService({
      repository: failingSaveRepository(context.repository),
      assetRepository: {
        findAssetDetail: (assetId) => context.assets.get(assetId)
      },
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
      createId: () => "cleanup-temp"
    });

    await expectCode(
      () =>
        failingService.save(
          PROJECT_ID,
          request({ videoElements: [videoInput()], sectionBgms: [] })
        ),
      PROJECT_EDIT_ERROR_CODE.cleanupFailed
    );
    expect(await fs.readFile(destination)).toEqual(video.bytes);
  });
});
