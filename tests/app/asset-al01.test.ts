import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AssetRevisionConflictError } from "../../src/app/assets/asset-errors.js";
import { NodeAssetFileStore } from "../../src/app/assets/asset-file-store.js";
import { AssetProcessingService } from "../../src/app/assets/asset-processing-service.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetService } from "../../src/app/assets/asset-service.js";
import type { AssetMediaProcessingPort } from "../../src/app/assets/processing/types.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { assetTags, tags } from "../../src/db/schema.js";
import { pngBytes } from "../fixtures/asset-fixtures.js";

const NOW = "2026-08-21T00:00:00.000Z";

describe("AL-01 asset revision and replacement lifecycle", () => {
  let workspaceRoot: string;
  let database:
    Awaited<ReturnType<typeof initializeWorkspaceDatabase>> | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (workspaceRoot !== undefined) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  async function createFixture(): Promise<{
    repository: AssetRepository;
    service: AssetService;
    fileStore: NodeAssetFileStore;
  }> {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), "subdub-al01-"));
    database = await initializeWorkspaceDatabase({ workspaceRoot });
    const repository = new AssetRepository(database.database);
    const fileStore = new NodeAssetFileStore(
      path.join(workspaceRoot, "library")
    );
    const service = new AssetService({
      repository,
      fileStore,
      now: () => new Date(NOW),
      createId: () => "unused"
    });

    database.database
      .insert(tags)
      .values({
        tagId: "tag-a",
        axis: "task",
        canonicalName: "作業",
        normalizedName: "作業",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
    repository.insertAsset({
      assetId: "asset-1",
      revision: 1,
      currentVersion: 1,
      kind: "photo",
      title: "旧タイトル",
      description: "旧説明",
      confidentiality: "internal",
      department: null,
      system: null,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW
    });
    repository.insertAssetVersion({
      assetId: "asset-1",
      version: 1,
      status: "ready",
      baseRevision: 1,
      baseCurrentVersion: null,
      libraryMediaPath: "media/asset-1/v1.png",
      mimeType: "image/png",
      createdAt: NOW,
      updatedAt: NOW
    });
    database.database
      .insert(assetTags)
      .values({ assetId: "asset-1", tagId: "tag-a", createdAt: NOW })
      .run();
    await fs.mkdir(
      path.dirname(fileStore.resolvePath("media/asset-1/v1.png")),
      {
        recursive: true
      }
    );
    await fs.writeFile(fileStore.resolvePath("media/asset-1/v1.png"), pngBytes);
    return { repository, service, fileStore };
  }

  it("updates metadata and tags atomically, then guards stale revisions", async () => {
    const { repository, service } = await createFixture();

    const updated = service.updateMetadata("asset-1", {
      expectedRevision: 1,
      title: "新タイトル",
      description: "新説明",
      confidentiality: "confidential",
      department: "総務",
      system: null,
      tagIds: []
    });
    expect(updated).toMatchObject({
      revision: 2,
      title: "新タイトル",
      description: "新説明",
      confidentiality: "confidential",
      department: "総務",
      currentVersion: 1
    });
    expect(repository.findAssetTagIds("asset-1")).toEqual([]);

    expect(() =>
      service.updateMetadata("asset-1", {
        expectedRevision: 1,
        title: "stale",
        description: "stale",
        confidentiality: "internal",
        department: null,
        system: null,
        tagIds: ["tag-a"]
      })
    ).toThrow(AssetRevisionConflictError);
    expect(repository.findAsset("asset-1")?.title).toBe("新タイトル");
  });

  it("deactivates and reactivates without deleting the current version", async () => {
    const { repository, service } = await createFixture();

    expect(
      service.updateStatus("asset-1", { expectedRevision: 1 }, "inactive")
    ).toMatchObject({
      status: "inactive",
      revision: 2,
      currentVersion: 1
    });
    expect(
      service.updateStatus("asset-1", { expectedRevision: 2 }, "active")
    ).toMatchObject({
      status: "active",
      revision: 3,
      currentVersion: 1
    });
    expect(repository.findAssetVersion("asset-1", 1)?.status).toBe("ready");
  });

  it("keeps v1 current while a replacement is processing, then switches atomically", async () => {
    const { repository, service, fileStore } = await createFixture();
    const staged = await service.stageUpload({
      stream: (await import("node:stream")).Readable.from([pngBytes]),
      mimeType: "image/png",
      filename: "replacement.png"
    });

    const receipt = await service.commitReplacement(
      "asset-1",
      { expectedRevision: "1" },
      staged
    );
    expect(receipt).toMatchObject({
      assetId: "asset-1",
      version: 2,
      revision: 2,
      currentVersion: 1,
      status: "processing"
    });
    expect(repository.findAssetDetail("asset-1")?.version).toBe(1);
    expect(repository.findAssetVersion("asset-1", 2)?.stagingPath).toMatch(
      /^staging\//
    );

    const processingService = new AssetProcessingService({
      repository,
      fileStore,
      processingPort: {
        async processMedia(): Promise<{
          metadata: {
            width: number;
            height: number;
            durationMs: null;
            pageCount: null;
          };
          thumbnails: Buffer[];
        }> {
          return {
            metadata: {
              width: 1,
              height: 1,
              durationMs: null,
              pageCount: null
            },
            thumbnails: [pngBytes]
          };
        }
      } satisfies AssetMediaProcessingPort,
      now: () => new Date(NOW)
    });
    await expect(processingService.processAsset("asset-1", 2)).resolves.toEqual(
      {
        status: "processed"
      }
    );

    expect(repository.findAsset("asset-1")).toMatchObject({
      status: "active",
      revision: 3,
      currentVersion: 2
    });
    expect(repository.findAssetVersion("asset-1", 1)?.status).toBe("ready");
    expect(repository.findAssetVersion("asset-1", 2)).toMatchObject({
      status: "ready",
      stagingPath: null
    });
    expect(repository.findAssetDetail("asset-1")?.pendingVersion).toBeNull();
    await expect(
      fs.access(fileStore.resolvePath("media/asset-1/v2.png"))
    ).resolves.toBeUndefined();
  });
});
