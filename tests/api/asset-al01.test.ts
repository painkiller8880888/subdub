import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { NodeAssetFileStore } from "../../src/app/assets/asset-file-store.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetService } from "../../src/app/assets/asset-service.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { assetVersions, assets, tags } from "../../src/db/schema.js";
import {
  assetDetailResponseSchema,
  apiErrorResponseSchema,
  assetReplacementResponseSchema,
  assetTagDictionaryResponseSchema
} from "../../src/schema/api.js";
import { buildMultipartBody, pngBytes } from "../fixtures/asset-fixtures.js";

const NOW = "2026-08-21T00:00:00.000Z";

describe("AL-01 asset management API", () => {
  let workspaceRoot: string;
  let database: Awaited<ReturnType<typeof initializeWorkspaceDatabase>>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), "subdub-al01-api-"));
    database = await initializeWorkspaceDatabase({ workspaceRoot });
    const repository = new AssetRepository(database.database);
    const fileStore = new NodeAssetFileStore(
      path.join(workspaceRoot, "library")
    );
    const service = new AssetService({
      repository,
      fileStore,
      now: () => new Date(NOW)
    });
    database.database
      .insert(tags)
      .values({
        tagId: "tag-api",
        axis: "task",
        canonicalName: "API素材",
        normalizedName: "api素材",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
    database.database
      .insert(assets)
      .values({
        assetId: "asset-api",
        revision: 1,
        currentVersion: 1,
        kind: "photo",
        title: "API素材",
        description: "説明",
        confidentiality: "internal",
        department: null,
        system: null,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
    database.database
      .insert(assetVersions)
      .values({
        assetId: "asset-api",
        version: 1,
        status: "ready",
        baseRevision: 1,
        baseCurrentVersion: null,
        libraryMediaPath: "media/asset-api/v1.png",
        mimeType: "image/png",
        checksum: "a".repeat(64),
        sizeBytes: pngBytes.length,
        width: 1,
        height: 1,
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
    app = buildApp({ assetService: service });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("updates metadata, toggles availability, reads active tags, and reserves replacement", async () => {
    const update = await app.inject({
      method: "PUT",
      url: "/api/assets/asset-api",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        expectedRevision: 1,
        title: "更新素材",
        description: "更新説明",
        confidentiality: "internal",
        department: null,
        system: null,
        tagIds: ["tag-api"]
      })
    });
    expect(update.statusCode).toBe(200);
    expect(assetDetailResponseSchema.parse(update.json()).data).toMatchObject({
      title: "更新素材",
      revision: 2,
      currentVersion: 1
    });

    const deactivated = await app.inject({
      method: "POST",
      url: "/api/assets/asset-api/deactivate",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ expectedRevision: 2 })
    });
    expect(deactivated.statusCode).toBe(200);
    expect(
      assetDetailResponseSchema.parse(deactivated.json()).data.status
    ).toBe("inactive");

    const activated = await app.inject({
      method: "POST",
      url: "/api/assets/asset-api/activate",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ expectedRevision: 3 })
    });
    expect(activated.statusCode).toBe(200);
    expect(assetDetailResponseSchema.parse(activated.json()).data.status).toBe(
      "active"
    );

    const tagResponse = await app.inject({
      method: "GET",
      url: "/api/asset-tags?status=active"
    });
    expect(tagResponse.statusCode).toBe(200);
    expect(
      assetTagDictionaryResponseSchema.parse(tagResponse.json()).data
    ).toEqual([expect.objectContaining({ tagId: "tag-api", axis: "task" })]);

    const multipart = buildMultipartBody([
      { name: "expectedRevision", value: "4" },
      {
        name: "file",
        filename: "replacement.png",
        mimeType: "image/png",
        data: pngBytes
      }
    ]);
    const replacement = await app.inject({
      method: "POST",
      url: "/api/assets/asset-api/replace",
      payload: multipart.body,
      headers: { "content-type": multipart.contentType }
    });
    expect(replacement.statusCode).toBe(200);
    expect(
      assetReplacementResponseSchema.parse(replacement.json()).data
    ).toMatchObject({
      assetId: "asset-api",
      version: 2,
      revision: 5,
      currentVersion: 1,
      status: "processing"
    });
  });

  it("returns a conflict without changing metadata", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/assets/asset-api",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        expectedRevision: 99,
        title: "stale",
        description: "stale",
        confidentiality: "internal",
        department: null,
        system: null,
        tagIds: []
      })
    });
    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      "ASSET_REVISION_CONFLICT"
    );
  });
});
