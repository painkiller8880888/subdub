import { afterEach, describe, expect, it } from "vitest";

import {
  activateAsset,
  createAsset,
  deactivateAsset,
  fetchAssetTags,
  replaceAsset,
  searchAssets,
  updateAssetMetadata
} from "../../src/web/lib/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const timestamp = "2026-08-24T00:00:00.000Z";
const detail = {
  assetId: "asset-client",
  revision: 2,
  currentVersion: 1,
  version: 1,
  versionStatus: "ready" as const,
  versionHistory: [],
  pendingVersion: null,
  tags: [],
  tagIds: [],
  kind: "video" as const,
  title: "Client asset",
  description: "Description",
  confidentiality: "internal",
  department: null,
  system: null,
  mimeType: "video/mp4",
  libraryMediaPath: "media/asset-client/v1.mp4",
  checksum: "a".repeat(64),
  sizeBytes: 1,
  width: null,
  height: null,
  durationMs: 1000,
  pageCount: null,
  thumbnailPaths: [],
  status: "active" as const,
  errorCode: null,
  errorMessage: null,
  createdAt: timestamp,
  updatedAt: timestamp
};

describe("asset management API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the complete create form as multipart and supports all-status search", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).startsWith("/api/assets?")) {
        return jsonResponse({
          data: {
            items: [],
            page: 1,
            pageSize: 24,
            total: 0,
            hasNextPage: false
          }
        });
      }
      return jsonResponse({
        data: {
          assetId: "asset-client",
          version: 1,
          revision: 1,
          currentVersion: null,
          kind: "video",
          title: "Client asset",
          description: "Description",
          mimeType: "video/mp4",
          confidentiality: "internal",
          department: "総務部",
          system: "申請システム",
          tagIds: ["tag-one"],
          status: "processing",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      });
    };

    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await expect(
      createAsset(
        {
          kind: "video",
          title: "  Client asset ",
          description: " Description ",
          confidentiality: "internal",
          department: "総務部",
          system: "申請システム",
          tagIds: ["tag-one"]
        },
        file
      )
    ).resolves.toMatchObject({ assetId: "asset-client", status: "processing" });
    await expect(
      searchAssets({ status: "all", page: 1, pageSize: 24 })
    ).resolves.toMatchObject({ total: 0 });

    const formData = calls[0]?.init?.body as FormData;
    expect(calls[0]?.input).toBe("/api/assets");
    expect(formData.get("kind")).toBe("video");
    expect(formData.get("title")).toBe("Client asset");
    expect(formData.getAll("tagIds")).toEqual(["tag-one"]);
    expect(formData.get("file")).toBeInstanceOf(Blob);
    expect(calls[1]?.input).toContain("status=all");
  });

  it("uses revision-safe metadata, status, replacement, and tag endpoints", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).includes("asset-tags")) {
        return jsonResponse({ data: [] });
      }
      if (String(input).includes("replace")) {
        return jsonResponse({
          data: {
            assetId: "asset-client",
            version: 2,
            revision: 3,
            currentVersion: 1,
            kind: "video",
            status: "processing",
            createdAt: timestamp,
            updatedAt: timestamp
          }
        });
      }
      return jsonResponse({ data: detail });
    };

    const file = new File(["video"], "replacement.mp4", {
      type: "video/mp4"
    });
    await expect(
      updateAssetMetadata("asset-client", {
        expectedRevision: 2,
        title: "Updated",
        description: "Updated description",
        confidentiality: "internal",
        department: null,
        system: null,
        tagIds: []
      })
    ).resolves.toEqual(detail);
    await expect(deactivateAsset("asset-client", 2)).resolves.toEqual(detail);
    await expect(activateAsset("asset-client", 3)).resolves.toEqual(detail);
    await expect(
      replaceAsset("asset-client", { expectedRevision: 4 }, file)
    ).resolves.toMatchObject({ version: 2, currentVersion: 1 });
    await expect(fetchAssetTags()).resolves.toEqual([]);

    expect(
      calls.map((call) => `${call.init?.method ?? "GET"} ${call.input}`)
    ).toEqual([
      "PUT /api/assets/asset-client",
      "POST /api/assets/asset-client/deactivate",
      "POST /api/assets/asset-client/activate",
      "POST /api/assets/asset-client/replace",
      "GET /api/asset-tags?status=active"
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      expectedRevision: 2,
      title: "Updated"
    });
    const replacementForm = calls[3]?.init?.body as FormData;
    expect(replacementForm.get("expectedRevision")).toBe("4");
    expect(replacementForm.get("file")).toBeInstanceOf(Blob);
  });
});
