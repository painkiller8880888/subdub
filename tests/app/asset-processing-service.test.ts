import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  AssetProcessingRaceError,
  AssetStagingFailedError
} from "../../src/app/assets/asset-errors.js";
import { AssetProcessingError } from "../../src/app/assets/asset-processing-errors.js";
import { NodeAssetFileStore } from "../../src/app/assets/asset-file-store.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetProcessingService } from "../../src/app/assets/asset-processing-service.js";
import type {
  AssetMediaProcessingInput,
  AssetMediaProcessingPort,
  AssetProcessedMedia
} from "../../src/app/assets/processing/types.js";
import { mediaFixture } from "../fixtures/media-fixtures.js";

const FIXED_NOW = "2026-08-06T00:00:00.000Z";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

class FakeMediaProcessingPort implements AssetMediaProcessingPort {
  readonly calls: AssetMediaProcessingInput[] = [];
  private readonly results: Map<string, AssetProcessedMedia | Error>;

  constructor(config: Record<string, AssetProcessedMedia | Error>) {
    this.results = new Map(Object.entries(config));
  }

  async processMedia(
    input: AssetMediaProcessingInput
  ): Promise<AssetProcessedMedia> {
    this.calls.push(input);
    const result = this.results.get(input.kind);
    if (result === undefined) {
      throw new AssetProcessingError("PROCESSING_INTERNAL_FAILED");
    }
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
}

function processed(
  metadata: AssetProcessedMedia["metadata"],
  thumbnails: Buffer[]
): AssetProcessedMedia {
  return { metadata, thumbnails };
}

describe("asset processing service", () => {
  let workspaceRoot: string;
  let db: Awaited<ReturnType<typeof initializeWorkspaceDatabase>> | undefined;
  let repository: AssetRepository;
  let fileStore: NodeAssetFileStore;
  let service: AssetProcessingService;
  let port: FakeMediaProcessingPort;

  afterEach(async () => {
    if (db !== undefined) {
      db.close();
    }
    if (workspaceRoot !== undefined) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  async function createService(
    portConfig: Record<string, AssetProcessedMedia | Error> = {}
  ): Promise<void> {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-asset-processing-")
    );
    db = await initializeWorkspaceDatabase({ workspaceRoot });
    repository = new AssetRepository(db.database);
    fileStore = new NodeAssetFileStore(path.join(workspaceRoot, "library"));
    port = new FakeMediaProcessingPort(portConfig);
    service = new AssetProcessingService({
      repository,
      fileStore,
      processingPort: port,
      now: () => new Date(FIXED_NOW)
    });
  }

  async function registerProcessingAsset(
    assetId: string,
    kind: "video" | "photo" | "document_scan" | "sound_effect",
    fileName: string,
    extension: string
  ): Promise<Buffer> {
    const bytes = await mediaFixture(fileName);
    const libraryMediaPath = `media/${assetId}/v1.${extension}`;
    await fs.mkdir(path.dirname(fileStore.resolvePath(libraryMediaPath)), {
      recursive: true
    });
    await fs.writeFile(fileStore.resolvePath(libraryMediaPath), bytes);
    repository.insertAsset({
      assetId,
      kind,
      title: "テスト素材",
      description: "",
      confidentiality: "internal",
      department: null,
      system: null,
      status: "processing",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    });
    repository.insertAssetVersion({
      assetId,
      version: 1,
      libraryMediaPath,
      mimeType: "application/octet-stream",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    });
    return bytes;
  }

  async function thumbnailsOnDisk(): Promise<string[]> {
    const thumbnailsRoot = path.join(workspaceRoot, "library", "thumbnails");
    const exists = await fs
      .access(thumbnailsRoot)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return [];
    }
    const entries = await fs.readdir(thumbnailsRoot, { recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
      const stat = await fs.stat(path.join(thumbnailsRoot, entry));
      if (stat.isFile()) {
        files.push(`thumbnails/${entry.replace(/\\/g, "/")}`);
      }
    }
    return files;
  }

  it("activates a video asset and persists metadata, checksum, and thumbnail", async () => {
    await createService({
      video: processed(
        { width: 320, height: 176, durationMs: 10027, pageCount: null },
        [Buffer.from("fake-png-video-thumb")]
      )
    });
    const bytes = await registerProcessingAsset(
      "asset-1",
      "video",
      "clip.mp4",
      "mp4"
    );

    const outcome = await service.processAsset("asset-1", 1);
    expect(outcome).toEqual({ status: "processed" });

    const asset = repository.findAsset("asset-1");
    expect(asset?.status).toBe("active");
    expect(asset?.errorCode).toBeNull();
    expect(asset?.errorMessage).toBeNull();

    const version = repository.findAssetVersion("asset-1", 1);
    expect(version?.checksum).toBe(sha256(bytes));
    expect(version?.sizeBytes).toBe(bytes.length);
    expect(version?.width).toBe(320);
    expect(version?.height).toBe(176);
    expect(version?.durationMs).toBe(10027);
    expect(version?.pageCount).toBeNull();
    expect(version?.thumbnailPaths).toBe(
      JSON.stringify(["thumbnails/asset-1/v1/frame.png"])
    );

    const thumbPath = path.join(
      workspaceRoot,
      "library",
      "thumbnails",
      "asset-1",
      "v1",
      "frame.png"
    );
    expect(await fs.readFile(thumbPath, "utf8")).toBe("fake-png-video-thumb");
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].kind).toBe("video");
    expect(port.calls[0].maxThumbnailEdgePx).toBe(480);
  });

  it("exposes a detail that only contains relative thumbnail paths", async () => {
    await createService({
      photo: processed(
        { width: 64, height: 48, durationMs: null, pageCount: null },
        [Buffer.from("fake-png-photo-thumb")]
      )
    });
    await registerProcessingAsset("asset-photo", "photo", "shot.png", "png");

    const outcome = await service.processAsset("asset-photo", 1);
    expect(outcome.status).toBe("processed");

    const detail = repository.findAssetDetail("asset-photo");
    expect(detail).toBeDefined();
    expect(detail?.status).toBe("active");
    expect(detail?.thumbnailPaths).toEqual([
      "thumbnails/asset-photo/v1/image.png"
    ]);
    for (const thumbnailPath of detail?.thumbnailPaths ?? []) {
      expect(thumbnailPath).toMatch(/^thumbnails\//);
      expect(thumbnailPath).not.toContain("\\");
      expect(thumbnailPath).not.toMatch(/^[a-zA-Z]:/);
      expect(thumbnailPath).not.toContain("..");
    }
  });

  it("persists ordered per-page thumbnails for a document scan", async () => {
    await createService({
      document_scan: processed(
        { width: 200, height: 150, durationMs: null, pageCount: 3 },
        [Buffer.from("page-1"), Buffer.from("page-2"), Buffer.from("page-3")]
      )
    });
    await registerProcessingAsset(
      "asset-scan",
      "document_scan",
      "scan-3pages.pdf",
      "pdf"
    );

    const outcome = await service.processAsset("asset-scan", 1);
    expect(outcome.status).toBe("processed");

    const version = repository.findAssetVersion("asset-scan", 1);
    expect(version?.pageCount).toBe(3);
    expect(version?.width).toBe(200);
    expect(version?.height).toBe(150);
    expect(version?.thumbnailPaths).toBe(
      JSON.stringify([
        "thumbnails/asset-scan/v1/page-0001.png",
        "thumbnails/asset-scan/v1/page-0002.png",
        "thumbnails/asset-scan/v1/page-0003.png"
      ])
    );
    expect(await thumbnailsOnDisk()).toEqual([
      "thumbnails/asset-scan/v1/page-0001.png",
      "thumbnails/asset-scan/v1/page-0002.png",
      "thumbnails/asset-scan/v1/page-0003.png"
    ]);
  });

  it("stores null thumbnail paths for sound effects without thumbnails", async () => {
    await createService({
      sound_effect: processed(
        { width: null, height: null, durationMs: 2000, pageCount: null },
        []
      )
    });
    await registerProcessingAsset(
      "asset-sfx",
      "sound_effect",
      "effect-2s.wav",
      "wav"
    );

    const outcome = await service.processAsset("asset-sfx", 1);
    expect(outcome.status).toBe("processed");
    const version = repository.findAssetVersion("asset-sfx", 1);
    expect(version?.durationMs).toBe(2000);
    expect(version?.width).toBeNull();
    expect(version?.thumbnailPaths).toBeNull();
    expect(await thumbnailsOnDisk()).toEqual([]);
  });

  it("records a normalized failure and cleans up placed thumbnails", async () => {
    await createService({
      video: new AssetProcessingError("PROCESSING_METADATA_FAILED")
    });
    await registerProcessingAsset("asset-fail", "video", "clip.mp4", "mp4");

    const outcome = await service.processAsset("asset-fail", 1);
    expect(outcome).toEqual({ status: "failed" });

    const asset = repository.findAsset("asset-fail");
    expect(asset?.status).toBe("error");
    expect(asset?.errorCode).toBe("PROCESSING_METADATA_FAILED");
    expect(typeof asset?.errorMessage).toBe("string");
    expect(asset?.errorMessage?.length).toBeGreaterThan(0);

    const version = repository.findAssetVersion("asset-fail", 1);
    expect(version?.checksum).toBeNull();
    expect(version?.thumbnailPaths).toBeNull();
    expect(await thumbnailsOnDisk()).toEqual([]);
    expect(
      await fs.access(fileStore.resolvePath("media/asset-fail/v1.mp4"))
    ).toBeUndefined();
  });

  it("rolls back both initial failure updates when the asset update fails", async () => {
    await createService({
      video: new AssetProcessingError("PROCESSING_METADATA_FAILED")
    });
    await registerProcessingAsset(
      "asset-failure-rollback",
      "video",
      "clip.mp4",
      "mp4"
    );
    db!.connection
      .prepare(
        `
        CREATE TRIGGER fail_initial_asset_error_update
        BEFORE UPDATE OF status ON assets
        WHEN OLD.asset_id = 'asset-failure-rollback'
          AND NEW.status = 'error'
        BEGIN
          SELECT RAISE(ABORT, 'injected asset update failure');
        END;
      `
      )
      .run();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        service.processAsset("asset-failure-rollback", 1)
      ).resolves.toEqual({ status: "failed" });

      expect(repository.findAsset("asset-failure-rollback")).toMatchObject({
        status: "processing",
        currentVersion: null,
        errorCode: null
      });
      expect(
        repository.findAssetVersion("asset-failure-rollback", 1)
      ).toMatchObject({
        status: "processing",
        errorCode: null,
        errorMessage: null
      });
      expect(repository.findProcessingAssetKeys()).toContainEqual({
        assetId: "asset-failure-rollback",
        version: 1
      });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("maps a missing media file to PROCESSING_MEDIA_NOT_FOUND", async () => {
    await createService({
      video: processed(
        { width: 320, height: 176, durationMs: 1000, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    await registerProcessingAsset("asset-missing", "video", "clip.mp4", "mp4");
    await fs.rm(fileStore.resolvePath("media/asset-missing/v1.mp4"), {
      force: true
    });

    const outcome = await service.processAsset("asset-missing", 1);
    expect(outcome).toEqual({ status: "failed" });
    expect(repository.findAsset("asset-missing")?.errorCode).toBe(
      "PROCESSING_MEDIA_NOT_FOUND"
    );
  });

  it("skips assets that are no longer processing and never calls the port", async () => {
    await createService({
      video: processed(
        { width: 320, height: 176, durationMs: 1000, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    const bytes = await registerProcessingAsset(
      "asset-active",
      "video",
      "clip.mp4",
      "mp4"
    );
    repository.markProcessingSucceeded({
      assetId: "asset-active",
      version: 1,
      checksum: sha256(bytes),
      sizeBytes: bytes.length,
      width: 320,
      height: 176,
      durationMs: 1000,
      pageCount: null,
      thumbnailPaths: [],
      updatedAt: FIXED_NOW
    });

    expect(await service.listProcessingAssetKeys()).toEqual([]);
    const outcome = await service.processAsset("asset-active", 1);
    expect(outcome).toEqual({ status: "skipped" });
    expect(port.calls).toHaveLength(0);
  });

  it("does not process pending keys for versions of active assets twice", async () => {
    await createService({
      photo: processed(
        { width: 64, height: 48, durationMs: null, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    await registerProcessingAsset("asset-twice", "photo", "shot.png", "png");

    const first = await service.processAsset("asset-twice", 1);
    expect(first.status).toBe("processed");
    const second = await service.processAsset("asset-twice", 1);
    expect(second).toEqual({ status: "skipped" });
    expect(port.calls).toHaveLength(1);
  });

  it("survives duplicate concurrent processing without corrupting data", async () => {
    await createService({
      video: processed(
        { width: 320, height: 176, durationMs: 1000, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    await registerProcessingAsset("asset-race", "video", "clip.mp4", "mp4");

    const outcomes = await Promise.all([
      service.processAsset("asset-race", 1),
      service.processAsset("asset-race", 1)
    ]);
    expect(outcomes.some((outcome) => outcome.status === "processed")).toBe(
      true
    );
    const asset = repository.findAsset("asset-race");
    expect(asset?.status).toBe("active");
    expect(asset?.errorCode).toBeNull();
    const version = repository.findAssetVersion("asset-race", 1);
    expect(version?.width).toBe(320);
    expect(version?.thumbnailPaths).not.toBeNull();
    const thumbnailPaths = JSON.parse(
      version!.thumbnailPaths as string
    ) as string[];
    expect(thumbnailPaths.length).toBeGreaterThan(0);
    for (const thumbnailPath of thumbnailPaths) {
      await expect(
        fs.access(fileStore.resolvePath(thumbnailPath))
      ).resolves.toBeUndefined();
    }
  });

  it("cleans up already-placed thumbnails when a later move fails", async () => {
    await createService({
      document_scan: processed(
        { width: 200, height: 150, durationMs: null, pageCount: 3 },
        [Buffer.from("page-1"), Buffer.from("page-2"), Buffer.from("page-3")]
      )
    });
    await registerProcessingAsset(
      "asset-scan-fail",
      "document_scan",
      "scan-3pages.pdf",
      "pdf"
    );
    const originalMoveToMedia = fileStore.moveToMedia.bind(fileStore);
    let moveCount = 0;
    vi.spyOn(fileStore, "moveToMedia").mockImplementation(
      async (relativePath, mediaRelativePath) => {
        moveCount += 1;
        if (moveCount === 2) {
          throw new AssetStagingFailedError(new Error("injected move failure"));
        }
        return originalMoveToMedia(relativePath, mediaRelativePath);
      }
    );

    const outcome = await service.processAsset("asset-scan-fail", 1);
    expect(outcome).toEqual({ status: "failed" });

    const asset = repository.findAsset("asset-scan-fail");
    expect(asset?.status).toBe("error");
    expect(asset?.errorCode).toBe("PROCESSING_THUMBNAIL_FAILED");
    const version = repository.findAssetVersion("asset-scan-fail", 1);
    expect(version?.checksum).toBeNull();
    expect(version?.thumbnailPaths).toBeNull();
    expect(await thumbnailsOnDisk()).toEqual([]);
  });

  it("does not leave empty thumbnail temp directories after success", async () => {
    await createService({
      photo: processed(
        { width: 64, height: 48, durationMs: null, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    await registerProcessingAsset("asset-temp", "photo", "shot.png", "png");

    const outcome = await service.processAsset("asset-temp", 1);
    expect(outcome.status).toBe("processed");

    const tempRoot = path.join(workspaceRoot, "library", "thumbnails-tmp");
    const exists = await fs
      .access(tempRoot)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      expect(await fs.readdir(tempRoot)).toEqual([]);
    }
  });

  it("rolls back the version update when the success guard loses the race", async () => {
    await createService({
      photo: processed(
        { width: 64, height: 48, durationMs: null, pageCount: null },
        [Buffer.from("thumb")]
      )
    });
    const bytes = await registerProcessingAsset(
      "asset-rollback",
      "photo",
      "shot.png",
      "png"
    );
    repository.markProcessingSucceeded({
      assetId: "asset-rollback",
      version: 1,
      checksum: sha256(bytes),
      sizeBytes: bytes.length,
      width: 64,
      height: 48,
      durationMs: null,
      pageCount: null,
      thumbnailPaths: [],
      updatedAt: FIXED_NOW
    });

    expect(() =>
      repository.transaction((transactionRepository) =>
        transactionRepository.markProcessingSucceeded({
          assetId: "asset-rollback",
          version: 1,
          checksum: "deadbeef",
          sizeBytes: 1,
          width: null,
          height: null,
          durationMs: null,
          pageCount: null,
          thumbnailPaths: [],
          updatedAt: FIXED_NOW
        })
      )
    ).toThrow(AssetProcessingRaceError);

    const version = repository.findAssetVersion("asset-rollback", 1);
    expect(version?.checksum).toBe(sha256(bytes));
    expect(version?.sizeBytes).toBe(bytes.length);
  });
});
