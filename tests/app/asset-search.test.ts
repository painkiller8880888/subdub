import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  assetTags,
  assetVersions,
  assets,
  tagAliases,
  tags
} from "../../src/db/schema.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetService } from "../../src/app/assets/asset-service.js";

const NOW = "2026-08-07T00:00:00.000Z";

describe("asset repository search", () => {
  const workspaceRoots: string[] = [];
  let database:
    Awaited<ReturnType<typeof initializeWorkspaceDatabase>> | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    await Promise.all(
      workspaceRoots
        .splice(0)
        .map((workspaceRoot) =>
          fs.rm(workspaceRoot, { recursive: true, force: true })
        )
    );
  });

  async function createRepository(): Promise<AssetRepository> {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-asset-search-")
    );
    workspaceRoots.push(workspaceRoot);
    database = await initializeWorkspaceDatabase({ workspaceRoot });
    return new AssetRepository(database.database);
  }

  function insertTag(
    tagId: string,
    canonicalName: string,
    status: "active" | "inactive" = "active"
  ) {
    database!.database
      .insert(tags)
      .values({
        tagId,
        axis: "task",
        canonicalName,
        normalizedName: canonicalName,
        status,
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
  }

  function insertAsset(
    assetId: string,
    values: Partial<{
      title: string;
      description: string;
      department: string | null;
      system: string | null;
      kind: "video" | "photo" | "document_scan" | "sound_effect";
      status: "processing" | "active" | "inactive" | "error";
      updatedAt: string;
    }> = {}
  ) {
    database!.database
      .insert(assets)
      .values({
        assetId,
        kind: values.kind ?? "photo",
        title: values.title ?? assetId,
        description: values.description ?? "",
        confidentiality: "internal",
        department: values.department ?? null,
        system: values.system ?? null,
        status: values.status ?? "active",
        createdAt: NOW,
        updatedAt: values.updatedAt ?? NOW
      })
      .run();
    database!.database
      .insert(assetVersions)
      .values({
        assetId,
        version: 1,
        libraryMediaPath: `media/${assetId}/v1.png`,
        mimeType: "image/png",
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();
  }

  function linkAsset(assetId: string, tagId: string) {
    database!.database
      .insert(assetTags)
      .values({
        assetId,
        tagId,
        createdAt: NOW
      })
      .run();
  }

  it("searches Japanese title, description, department, system, canonical tags, and aliases", async () => {
    const repository = await createRepository();
    insertTag("tag-application", "申請手順");
    database!.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-application",
        tagId: "tag-application",
        alias: "申請フロー",
        normalizedAlias: "申請フロー",
        createdAt: NOW
      })
      .run();
    insertAsset("asset-search", {
      title: "画面操作の写真",
      description: "パスワード更新の手順",
      department: "総務部",
      system: "申請システム"
    });
    linkAsset("asset-search", "tag-application");

    for (const query of [
      "画面操作",
      "パスワード",
      "総務部",
      "申請システム",
      "申請手順",
      "申請フロー"
    ]) {
      expect(
        repository
          .list({
            q: query,
            status: "active",
            tagIds: [],
            page: 1,
            pageSize: 20
          })
          .items.map((item) => item.assetId)
      ).toEqual(["asset-search"]);
    }

    expect(
      repository
        .list({
          q: "更新",
          status: "active",
          tagIds: [],
          page: 1,
          pageSize: 20
        })
        .items.map((item) => item.assetId)
    ).toEqual(["asset-search"]);
  });

  it("resolves a requested Asset version without falling back to the latest", async () => {
    const repository = await createRepository();
    insertAsset("asset-versioned", { kind: "video" });
    database!.database
      .insert(assetVersions)
      .values({
        assetId: "asset-versioned",
        version: 2,
        libraryMediaPath: "media/asset-versioned/v2.mp4",
        mimeType: "video/mp4",
        createdAt: NOW,
        updatedAt: NOW
      })
      .run();

    expect(repository.findAssetDetail("asset-versioned")?.version).toBe(2);
    expect(repository.findAssetDetail("asset-versioned", 1)?.version).toBe(1);
    expect(repository.findAssetDetail("asset-versioned", 2)?.version).toBe(2);
    expect(repository.findAssetDetail("asset-versioned", 3)).toBeUndefined();
  });

  it("keeps the search document synchronized for metadata, tags, and aliases", async () => {
    const repository = await createRepository();
    insertTag("tag-work", "作業手順");
    insertAsset("asset-sync", { title: "旧タイトル" });
    linkAsset("asset-sync", "tag-work");

    expect(
      repository.list({
        q: "旧タイトル",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(1);
    database!.database
      .update(assets)
      .set({ title: "新タイトル", updatedAt: NOW })
      .where(eq(assets.assetId, "asset-sync"))
      .run();
    expect(
      repository.list({
        q: "旧タイトル",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(0);
    expect(
      repository.list({
        q: "新タイトル",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(1);

    database!.database
      .update(tags)
      .set({
        canonicalName: "新しい作業",
        normalizedName: "新しい作業",
        updatedAt: NOW
      })
      .where(eq(tags.tagId, "tag-work"))
      .run();
    expect(
      repository.list({
        q: "作業手順",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(0);
    expect(
      repository.list({
        q: "新しい作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(1);

    database!.database
      .update(tags)
      .set({ status: "inactive", updatedAt: NOW })
      .where(eq(tags.tagId, "tag-work"))
      .run();
    expect(
      repository.list({
        q: "新しい作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(0);
    database!.database
      .update(tags)
      .set({ status: "active", updatedAt: NOW })
      .where(eq(tags.tagId, "tag-work"))
      .run();

    database!.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-work",
        tagId: "tag-work",
        alias: "現場作業",
        normalizedAlias: "現場作業",
        createdAt: NOW
      })
      .run();
    expect(
      repository.list({
        q: "現場作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(1);
    database!.database
      .update(tagAliases)
      .set({ alias: "日常作業", normalizedAlias: "日常作業" })
      .where(eq(tagAliases.aliasId, "alias-work"))
      .run();
    expect(
      repository.list({
        q: "現場作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(0);
    expect(
      repository.list({
        q: "日常作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(1);
    database!.database
      .delete(tagAliases)
      .where(eq(tagAliases.aliasId, "alias-work"))
      .run();
    expect(
      repository.list({
        q: "日常作業",
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total
    ).toBe(0);
  });

  it("removes canonical and alias search results when an asset tag is deleted", async () => {
    const repository = await createRepository();
    insertTag("tag-removable", "解除対象タグ");
    database!.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-removable",
        tagId: "tag-removable",
        alias: "解除対象別名",
        normalizedAlias: "解除対象別名",
        createdAt: NOW
      })
      .run();
    insertAsset("asset-unlinked");
    linkAsset("asset-unlinked", "tag-removable");

    const search = (q: string) =>
      repository.list({
        q,
        status: "active",
        tagIds: [],
        page: 1,
        pageSize: 20
      }).total;

    expect(search("解除対象タグ")).toBe(1);
    expect(search("解除対象別名")).toBe(1);

    database!.database
      .delete(assetTags)
      .where(eq(assetTags.assetId, "asset-unlinked"))
      .run();

    expect(search("解除対象タグ")).toBe(0);
    expect(search("解除対象別名")).toBe(0);
  });

  it("uses explicit status filters, AND tag filters, and deterministic pagination", async () => {
    const repository = await createRepository();
    const service = new AssetService({ repository });
    insertTag("tag-one", "一つ目");
    insertTag("tag-two", "二つ目");
    insertAsset("asset-b", { updatedAt: NOW });
    insertAsset("asset-a", { updatedAt: NOW });
    insertAsset("asset-inactive", { status: "inactive" });
    insertAsset("asset-error", { status: "error" });
    insertAsset("asset-processing", { status: "processing" });
    linkAsset("asset-a", "tag-one");
    linkAsset("asset-a", "tag-two");
    linkAsset("asset-b", "tag-one");

    const firstPage = repository.list({
      status: "active",
      tagIds: [],
      page: 1,
      pageSize: 1
    });
    const secondPage = repository.list({
      status: "active",
      tagIds: [],
      page: 2,
      pageSize: 1
    });
    expect(firstPage.items.map((item) => item.assetId)).toEqual(["asset-a"]);
    expect(secondPage.items.map((item) => item.assetId)).toEqual(["asset-b"]);
    expect(
      repository
        .list({
          status: "active",
          tagIds: ["tag-one", "tag-two"],
          page: 1,
          pageSize: 20
        })
        .items.map((item) => item.assetId)
    ).toEqual(["asset-a"]);
    expect(
      repository
        .list({ status: "inactive", tagIds: [], page: 1, pageSize: 20 })
        .items.map((item) => item.assetId)
    ).toEqual(["asset-inactive"]);
    expect(
      repository
        .list({ status: "error", tagIds: [], page: 1, pageSize: 20 })
        .items.map((item) => item.assetId)
    ).toEqual(["asset-error"]);
    expect(
      repository
        .list({ status: "processing", tagIds: [], page: 1, pageSize: 20 })
        .items.map((item) => item.assetId)
    ).toEqual(["asset-processing"]);
    expect(
      service.list({ page: 1, pageSize: 20 }).items.map((item) => item.assetId)
    ).toEqual(["asset-a", "asset-b"]);
  });

  it("resolves active tag aliases and applies visual required, optional, excluded, and kind filters", async () => {
    const repository = await createRepository();
    insertTag("tag-required", "required");
    insertTag("tag-optional", "optional");
    insertTag("tag-excluded", "excluded");
    insertTag("tag-inactive", "inactive", "inactive");
    database!.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-required",
        tagId: "tag-required",
        alias: "required alias",
        normalizedAlias: "required alias",
        createdAt: NOW
      })
      .run();

    insertAsset("asset-best", { title: "visual unique", kind: "photo" });
    insertAsset("asset-video", { kind: "video" });
    insertAsset("asset-sound", { kind: "sound_effect" });
    insertAsset("asset-inactive", { status: "inactive" });
    insertAsset("asset-error", { status: "error" });
    insertAsset("asset-excluded");
    linkAsset("asset-best", "tag-required");
    linkAsset("asset-best", "tag-optional");
    linkAsset("asset-video", "tag-required");
    linkAsset("asset-sound", "tag-required");
    linkAsset("asset-inactive", "tag-required");
    linkAsset("asset-error", "tag-required");
    linkAsset("asset-excluded", "tag-required");
    linkAsset("asset-excluded", "tag-excluded");

    expect(repository.findActiveTagDictionary()).toEqual([
      {
        tagId: "tag-excluded",
        axis: "task",
        canonicalName: "excluded",
        normalizedName: "excluded",
        aliases: []
      },
      {
        tagId: "tag-optional",
        axis: "task",
        canonicalName: "optional",
        normalizedName: "optional",
        aliases: []
      },
      {
        tagId: "tag-required",
        axis: "task",
        canonicalName: "required",
        normalizedName: "required",
        aliases: [
          {
            alias: "required alias",
            normalizedAlias: "required alias"
          }
        ]
      }
    ]);

    const ranked = repository.searchVisual({
      requiredTagIds: ["tag-required"],
      optionalTagIds: ["tag-optional"],
      excludedTagIds: ["tag-excluded"],
      kinds: ["photo", "video"] as const,
      limit: 20
    });
    expect(ranked.items.map((item) => item.assetId)).toEqual([
      "asset-best",
      "asset-video"
    ]);

    const first = repository.searchVisual({
      requiredTagIds: ["tag-required"],
      optionalTagIds: ["tag-optional"],
      excludedTagIds: ["tag-excluded"],
      kinds: ["photo", "video"] as const,
      q: "visual unique",
      limit: 20
    });
    const second = repository.searchVisual({
      requiredTagIds: ["tag-required"],
      optionalTagIds: ["tag-optional"],
      excludedTagIds: ["tag-excluded"],
      kinds: ["photo", "video"] as const,
      q: "visual unique",
      limit: 20
    });
    expect(first.items.map((item) => item.assetId)).toEqual(["asset-best"]);
    expect(first.items.map((item) => item.assetId)).toEqual(
      second.items.map((item) => item.assetId)
    );
    expect(first.items[0]?.status).toBe("active");
    expect(first.total).toBe(1);
    expect(
      repository.searchVisual({
        requiredTagIds: ["tag-required"],
        optionalTagIds: [],
        excludedTagIds: [],
        kinds: ["sound_effect"] as never,
        limit: 20
      })
    ).toEqual({ items: [], total: 0 });
  });
});
