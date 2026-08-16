import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { AssetFormatMismatchError } from "../../src/app/assets/asset-errors.js";
import { NodeAssetFileStore } from "../../src/app/assets/asset-file-store.js";
import { AssetProcessingService } from "../../src/app/assets/asset-processing-service.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetService } from "../../src/app/assets/asset-service.js";
import { createRealMediaProcessingPort } from "../../src/app/assets/processing/real-media-processing.js";
import type { AssetMediaProcessingPort } from "../../src/app/assets/processing/types.js";
import { mp3Bytes, mp4Bytes } from "../fixtures/asset-fixtures.js";

const NOW = "2026-08-16T00:00:00.000Z";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("BGM assets", () => {
  let workspaceRoot: string | undefined;
  let db: Awaited<ReturnType<typeof initializeWorkspaceDatabase>> | undefined;
  let repository: AssetRepository;
  let fileStore: NodeAssetFileStore;
  let assetService: AssetService;
  let nextId = 0;

  afterEach(async () => {
    db?.close();
    db = undefined;
    if (workspaceRoot !== undefined) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      workspaceRoot = undefined;
    }
  });

  async function setup(): Promise<void> {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), "subdub-bgm-"));
    db = await initializeWorkspaceDatabase({ workspaceRoot });
    repository = new AssetRepository(db.database);
    fileStore = new NodeAssetFileStore(path.join(workspaceRoot, "library"));
    assetService = new AssetService({
      repository,
      fileStore,
      now: () => new Date(NOW),
      createId: () => `asset-bgm-${++nextId}`
    });
  }

  async function register(
    kind: "video" | "bgm",
    bytes: Buffer,
    mimeType: string,
    filename?: string
  ) {
    const staged = await assetService.stageUpload({
      stream: Readable.from([bytes]),
      mimeType,
      filename
    });
    return assetService.commitUpload(
      { kind, title: `${kind} test`, tagIds: [] },
      staged
    );
  }

  it("accepts only MP4/video-mp4 and MP3/audio-mpeg combinations with matching extensions", async () => {
    await setup();

    const video = await register("video", mp4Bytes, "video/mp4", "clip.mp4");
    expect(video).toMatchObject({
      kind: "video",
      mimeType: "video/mp4",
      status: "processing"
    });
    expect(repository.findAssetVersion(video.assetId, 1)?.libraryMediaPath).toBe(
      `media/${video.assetId}/v1.mp4`
    );

    const bgm = await register("bgm", mp3Bytes, "audio/mpeg", "music.MP3");
    expect(bgm).toMatchObject({
      kind: "bgm",
      mimeType: "audio/mpeg",
      status: "processing"
    });
    expect(repository.findAssetVersion(bgm.assetId, 1)?.libraryMediaPath).toBe(
      `media/${bgm.assetId}/v1.mp3`
    );
  });

  it("rejects extension, MIME, kind, and detected-format mismatches before persistence", async () => {
    await setup();

    await expect(
      register("video", mp4Bytes, "video/mp4", "clip.mov")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
    await expect(
      register("bgm", mp3Bytes, "audio/mpeg", "music.wav")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
    await expect(
      register("bgm", mp3Bytes, "video/mp4", "music.mp3")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
    await expect(
      register("bgm", mp4Bytes, "audio/mpeg", "music.mp3")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
    await expect(
      register("video", mp3Bytes, "video/mp4", "clip.mp4")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
    await expect(
      register("bgm", mp3Bytes, "audio/mpeg")
    ).rejects.toBeInstanceOf(AssetFormatMismatchError);
  });

  it("activates BGM only with positive duration and keeps video dimensions null", async () => {
    await setup();
    const receipt = await register("bgm", mp3Bytes, "audio/mpeg", "music.mp3");
    const processingPort: AssetMediaProcessingPort = {
      async processMedia(input) {
        expect(input.kind).toBe("bgm");
        return {
          metadata: {
            width: null,
            height: null,
            durationMs: 12_345,
            pageCount: null
          },
          thumbnails: []
        };
      }
    };
    const processingService = new AssetProcessingService({
      repository,
      fileStore,
      processingPort,
      now: () => new Date(NOW)
    });

    await expect(processingService.processAsset(receipt.assetId, 1)).resolves.toEqual({
      status: "processed"
    });

    const asset = repository.findAsset(receipt.assetId);
    const version = repository.findAssetVersion(receipt.assetId, 1);
    expect(asset?.status).toBe("active");
    expect(version).toMatchObject({
      checksum: sha256(mp3Bytes),
      sizeBytes: mp3Bytes.length,
      width: null,
      height: null,
      durationMs: 12_345,
      pageCount: null,
      thumbnailPaths: null
    });

    const list = repository.list({
      kind: "bgm",
      status: "active",
      tagIds: [],
      page: 1,
      pageSize: 20
    });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      assetId: receipt.assetId,
      kind: "bgm",
      mimeType: "audio/mpeg",
      width: null,
      height: null,
      durationMs: 12_345,
      status: "active"
    });
  });

  it("moves invalid BGM metadata to error instead of active", async () => {
    await setup();
    const receipt = await register("bgm", mp3Bytes, "audio/mpeg", "music.mp3");
    const processingService = new AssetProcessingService({
      repository,
      fileStore,
      processingPort: {
        async processMedia() {
          return {
            metadata: {
              width: 1920,
              height: null,
              durationMs: 1000,
              pageCount: null
            },
            thumbnails: []
          };
        }
      },
      now: () => new Date(NOW)
    });

    await expect(processingService.processAsset(receipt.assetId, 1)).resolves.toEqual({
      status: "failed"
    });
    expect(repository.findAsset(receipt.assetId)).toMatchObject({
      status: "error",
      errorCode: "PROCESSING_METADATA_FAILED"
    });
  });

  it("does not activate an ID3-only file that passes registration preflight", async () => {
    await setup();
    const receipt = await register("bgm", mp3Bytes, "audio/mpeg", "spoof.mp3");
    const processingService = new AssetProcessingService({
      repository,
      fileStore,
      processingPort: createRealMediaProcessingPort(),
      now: () => new Date(NOW)
    });

    await expect(processingService.processAsset(receipt.assetId, 1)).resolves.toEqual({
      status: "failed"
    });
    expect(repository.findAsset(receipt.assetId)?.status).toBe("error");
  });

  it("defensively excludes BGM from generic visual search", async () => {
    await setup();
    const unsafeKinds = ["bgm"] as unknown as readonly (
      | "video"
      | "photo"
      | "document_scan"
    )[];
    expect(
      repository.searchVisual({
        requiredTagIds: [],
        optionalTagIds: [],
        excludedTagIds: [],
        kinds: unsafeKinds,
        limit: 20
      })
    ).toEqual({ items: [], total: 0 });
  });
});
