import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import { and, eq } from "drizzle-orm";
import {
  assetTags,
  assetVersions,
  assets,
  tagAliases,
  tags
} from "../../src/db/schema.js";
import { DEFAULT_ASSET_UPLOAD_LIMITS } from "../../src/app/assets/asset-upload-limits.js";
import {
  apiErrorResponseSchema,
  assetDetailResponseSchema,
  assetListResponseSchema,
  assetUploadResponseSchema
} from "../../src/schema/api.js";
import {
  buildMultipartBody,
  jpegBytes,
  mp4Bytes,
  pdfBytes,
  pngBytes,
  wavBytes,
  type MultipartPart
} from "../fixtures/asset-fixtures.js";

describe("asset upload API", () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), "subdub-assets-api-"));
    server = await initializeServer({ workspaceRoot });
  });

  afterEach(async () => {
    await server.app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function upload(parts: readonly MultipartPart[]) {
    const { body, contentType } = buildMultipartBody(parts);
    return server.app.inject({
      method: "POST",
      url: "/api/assets",
      payload: body,
      headers: { "content-type": contentType }
    });
  }

  function field(name: string, value: string): MultipartPart {
    return { name, value };
  }

  function file(
    data: Buffer,
    mimeType: string,
    filename: string
  ): MultipartPart {
    return { name: "file", filename, mimeType, data };
  }

  function apiError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).not.toBe(200);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  async function insertTag(tagId: string) {
    const now = "2026-08-06T00:00:00.000Z";
    server.database.database
      .insert(tags)
      .values({
        tagId,
        axis: "department",
        canonicalName: tagId,
        normalizedName: tagId,
        status: "active",
        createdAt: now,
        updatedAt: now
      })
      .run();
  }

  function insertSearchAsset(
    assetId: string,
    values: Partial<{
      title: string;
      description: string;
      department: string | null;
      system: string | null;
      status: "processing" | "active" | "inactive" | "error";
    }> = {}
  ) {
    const now = "2026-08-07T00:00:00.000Z";
    server.database.database
      .insert(assets)
      .values({
        assetId,
        kind: "photo",
        title: values.title ?? assetId,
        description: values.description ?? "",
        confidentiality: "internal",
        department: values.department ?? null,
        system: values.system ?? null,
        status: values.status ?? "active",
        createdAt: now,
        updatedAt: now
      })
      .run();
    server.database.database
      .insert(assetVersions)
      .values({
        assetId,
        version: 1,
        libraryMediaPath: `media/${assetId}/v1.png`,
        mimeType: "image/png",
        createdAt: now,
        updatedAt: now
      })
      .run();
  }

  function linkSearchAsset(assetId: string, tagId: string) {
    server.database.database
      .insert(assetTags)
      .values({
        assetId,
        tagId,
        createdAt: "2026-08-07T00:00:00.000Z"
      })
      .run();
  }

  async function stagingFiles(): Promise<string[]> {
    return fs.readdir(path.join(workspaceRoot, "library", "staging"));
  }

  async function mediaFiles(): Promise<string[]> {
    const mediaRoot = path.join(workspaceRoot, "library", "media");
    const entries = await fs.readdir(mediaRoot, { recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
      const stat = await fs.stat(path.join(mediaRoot, entry));
      if (stat.isFile()) files.push(entry);
    }
    return files;
  }

  it("lists active assets with full-text, tag, structured filters, and pagination", async () => {
    await insertTag("tag-application");
    server.database.database
      .update(tags)
      .set({ canonicalName: "申請手順", normalizedName: "申請手順" })
      .where(eq(tags.tagId, "tag-application"))
      .run();
    server.database.database
      .insert(tagAliases)
      .values({
        aliasId: "alias-application",
        tagId: "tag-application",
        alias: "申請フロー",
        normalizedAlias: "申請フロー",
        createdAt: "2026-08-07T00:00:00.000Z"
      })
      .run();
    insertSearchAsset("asset-a", {
      title: "申請画面",
      description: "パスワード更新の説明",
      department: "総務部",
      system: "申請システム"
    });
    insertSearchAsset("asset-b", {
      title: "別の画面",
      description: "別の説明",
      department: "総務部",
      system: "申請システム"
    });
    insertSearchAsset("asset-inactive", {
      title: "申請画面",
      status: "inactive"
    });
    insertSearchAsset("asset-error", {
      title: "申請画面",
      status: "error"
    });
    insertSearchAsset("asset-processing", {
      title: "申請画面",
      status: "processing"
    });
    linkSearchAsset("asset-a", "tag-application");

    const response = await server.app.inject({
      method: "GET",
      url: `/api/assets?q=${encodeURIComponent("申請フロー")}&department=${encodeURIComponent("総務部")}&system=${encodeURIComponent("申請システム")}&tagIds=tag-application&page=1&pageSize=1`
    });
    expect(response.statusCode).toBe(200);
    const result = assetListResponseSchema.parse(response.json()).data;
    expect(result.items.map((item) => item.assetId)).toEqual(["asset-a"]);
    expect(result.total).toBe(1);
    expect(result.items[0]?.tags).toEqual([
      {
        tagId: "tag-application",
        axis: "department",
        canonicalName: "申請手順"
      }
    ]);

    const defaultResponse = await server.app.inject({
      method: "GET",
      url: "/api/assets?page=1&pageSize=20"
    });
    const defaultResult = assetListResponseSchema.parse(
      defaultResponse.json()
    ).data;
    expect(defaultResult.items.map((item) => item.assetId)).toEqual([
      "asset-a",
      "asset-b"
    ]);
    expect(defaultResult.items.every((item) => item.status === "active")).toBe(
      true
    );

    const explicitStatusResponse = await server.app.inject({
      method: "GET",
      url: "/api/assets?status=error&page=1&pageSize=20"
    });
    expect(
      assetListResponseSchema
        .parse(explicitStatusResponse.json())
        .data.items.map((item) => item.assetId)
    ).toEqual(["asset-error"]);
  });

  it("does not treat FTS punctuation as query language or return a server error", async () => {
    for (const query of ["'", '"', "-", "(", ")", ":", "*", "日本語。", "  "]) {
      const response = await server.app.inject({
        method: "GET",
        url: `/api/assets?q=${encodeURIComponent(query)}`
      });
      expect(response.statusCode).toBe(200);
      expect(() =>
        assetListResponseSchema.parse(response.json())
      ).not.toThrow();
    }
  });

  it("registers sound_effect, photo, video, and document_scan fixtures", async () => {
    await insertTag("tag-a");
    await insertTag("tag-b");
    await insertTag("confirm");

    const cases: Array<{
      kind: string;
      data: Buffer;
      mimeType: string;
      filename: string;
    }> = [
      {
        kind: "sound_effect",
        data: wavBytes,
        mimeType: "audio/wav",
        filename: "effect.wav"
      },
      {
        kind: "photo",
        data: pngBytes,
        mimeType: "image/png",
        filename: "shot.png"
      },
      {
        kind: "photo",
        data: jpegBytes,
        mimeType: "image/jpeg",
        filename: "shot.jpg"
      },
      {
        kind: "video",
        data: mp4Bytes,
        mimeType: "video/mp4",
        filename: "clip.mp4"
      },
      {
        kind: "document_scan",
        data: pdfBytes,
        mimeType: "application/pdf",
        filename: "scan.pdf"
      }
    ];

    for (const testCase of cases) {
      const response = await upload([
        field("kind", testCase.kind),
        field("title", " 素材 "),
        field("description", "説明"),
        field("department", "部署"),
        field("system", "システム"),
        field("confidentiality", "confidential"),
        field("tagIds", "tag-b"),
        field("tagIds", "tag-a"),
        field("tagIds", "confirm"),
        field("tagIds", "tag-b"),
        file(testCase.data, testCase.mimeType, testCase.filename)
      ]);
      expect(response.statusCode).toBe(200);
      const receipt = assetUploadResponseSchema.parse(response.json()).data;
      expect(receipt).toMatchObject({
        version: 1,
        kind: testCase.kind,
        title: "素材",
        description: "説明",
        mimeType: testCase.mimeType,
        confidentiality: "confidential",
        department: "部署",
        system: "システム",
        status: "processing",
        tagIds: ["tag-b", "tag-a", "confirm"]
      });
      expect(receipt.assetId).toMatch(/^[a-z0-9-]+$/);
      expect(response.body).not.toContain("staging");
      expect(response.body).not.toContain("library");
    }

    expect(await mediaFiles()).toHaveLength(5);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects a missing file with 422", async () => {
    const response = await upload([
      field("kind", "photo"),
      field("title", "no file")
    ]);
    expect(response.statusCode).toBe(422);
    expect(apiError(response).code).toBe("ASSET_FILE_MISSING");
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects a missing required field with 422", async () => {
    const response = await upload([
      field("kind", "photo"),
      file(pngBytes, "image/png", "shot.png")
    ]);
    expect(response.statusCode).toBe(422);
    expect(apiError(response).code).toBe("REQUEST_VALIDATION_FAILED");
    expect(await mediaFiles()).toEqual([]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects unknown fields and unknown file field names", async () => {
    const unknownField = await upload([
      field("kind", "photo"),
      field("title", "t"),
      field("mystery", "x"),
      file(pngBytes, "image/png", "shot.png")
    ]);
    expect(unknownField.statusCode).toBe(400);
    expect(apiError(unknownField).code).toBe("ASSET_INVALID_FIELD");

    const unknownFile = await upload([
      field("kind", "photo"),
      field("title", "t"),
      {
        name: "avatar",
        filename: "a.png",
        mimeType: "image/png",
        data: pngBytes
      }
    ]);
    expect(unknownFile.statusCode).toBe(400);
    expect(apiError(unknownFile).code).toBe("ASSET_INVALID_FIELD");
    expect(await mediaFiles()).toEqual([]);
  });

  it("rejects multiple files with 413", async () => {
    const response = await upload([
      field("kind", "photo"),
      field("title", "t"),
      file(pngBytes, "image/png", "a.png"),
      file(jpegBytes, "image/jpeg", "b.jpg")
    ]);
    expect(response.statusCode).toBe(413);
    expect(apiError(response).code).toBe("ASSET_TOO_MANY_FILES");
    expect(await mediaFiles()).toEqual([]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects format, kind, and MIME mismatches and unsupported formats", async () => {
    const mismatch = await upload([
      field("kind", "video"),
      field("title", "t"),
      file(wavBytes, "audio/wav", "wrong.wav")
    ]);
    expect(mismatch.statusCode).toBe(422);
    expect(apiError(mismatch).code).toBe("ASSET_FORMAT_MISMATCH");

    const unsupported = await upload([
      field("kind", "photo"),
      field("title", "t"),
      file(Buffer.from("not an image", "latin1"), "text/plain", "x.txt")
    ]);
    expect(unsupported.statusCode).toBe(422);
    expect(apiError(unsupported).code).toBe("ASSET_UNSUPPORTED_FORMAT");

    const declaredMimeMismatch = await upload([
      field("kind", "photo"),
      field("title", "t"),
      file(jpegBytes, "image/png", "mismatch.png")
    ]);
    expect(declaredMimeMismatch.statusCode).toBe(422);
    expect(apiError(declaredMimeMismatch).code).toBe("ASSET_FORMAT_MISMATCH");

    expect(await mediaFiles()).toEqual([]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects empty files with 422", async () => {
    const response = await upload([
      field("kind", "photo"),
      field("title", "t"),
      file(Buffer.alloc(0), "image/png", "empty.png")
    ]);
    expect(response.statusCode).toBe(422);
    expect(apiError(response).code).toBe("ASSET_FILE_EMPTY");
    expect(await mediaFiles()).toEqual([]);
  });

  it("rejects nonexistent tags with 422", async () => {
    const response = await upload([
      field("kind", "sound_effect"),
      field("title", "t"),
      field("tagIds", "missing-tag"),
      file(wavBytes, "audio/wav", "e.wav")
    ]);
    expect(response.statusCode).toBe(422);
    expect(apiError(response).code).toBe("ASSET_TAG_NOT_FOUND");
    expect(await mediaFiles()).toEqual([]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects overlong filenames with 400", async () => {
    const response = await upload([
      field("kind", "photo"),
      field("title", "t"),
      file(pngBytes, "image/png", "x".repeat(256) + ".png")
    ]);
    expect(response.statusCode).toBe(400);
    expect(apiError(response).code).toBe("ASSET_INVALID_FIELD");
    expect(await mediaFiles()).toEqual([]);
  });

  it("rejects truncated uploads without side effects", async () => {
    const boundary = "----subdub-truncated-boundary";
    const truncatedBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="kind"\r\n\r\nphoto\r\n'
      ),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="title"\r\n\r\nt\r\n'),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="x.png"\r\n'
      ),
      Buffer.from("Content-Type: image/png\r\n\r\n"),
      pngBytes.subarray(0, 10)
    ]);

    const response = await server.app.inject({
      method: "POST",
      url: "/api/assets",
      payload: truncatedBody,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
    });

    expect(response.statusCode).toBe(400);
    expect(apiError(response).code).toBe("ASSET_UPLOAD_INTERRUPTED");
    expect(await mediaFiles()).toEqual([]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("rejects requests that exceed the field count limit", async () => {
    const serverWithLimits = await initializeServer({
      workspaceRoot: await fs.mkdtemp(
        path.join(tmpdir(), "subdub-assets-limits-")
      ),
      assetUploadLimits: { ...DEFAULT_ASSET_UPLOAD_LIMITS, maxFieldCount: 4 }
    });
    try {
      const { body, contentType } = buildMultipartBody([
        field("kind", "photo"),
        field("title", "t"),
        field("tagIds", "a"),
        field("tagIds", "b"),
        field("tagIds", "c"),
        field("tagIds", "d"),
        field("tagIds", "e"),
        file(pngBytes, "image/png", "shot.png")
      ]);
      const response = await serverWithLimits.app.inject({
        method: "POST",
        url: "/api/assets",
        payload: body,
        headers: { "content-type": contentType }
      });
      expect(response.statusCode).toBe(413);
      expect(apiError(response).code).toBe("ASSET_TOO_MANY_FIELDS");
    } finally {
      await serverWithLimits.app.close();
    }
  });

  it("rejects requests that exceed the part count limit", async () => {
    const serverWithLimits = await initializeServer({
      workspaceRoot: await fs.mkdtemp(
        path.join(tmpdir(), "subdub-assets-limits-")
      ),
      assetUploadLimits: { ...DEFAULT_ASSET_UPLOAD_LIMITS, maxPartCount: 4 }
    });
    try {
      const { body, contentType } = buildMultipartBody([
        field("kind", "photo"),
        field("title", "t"),
        field("tagIds", "a"),
        field("tagIds", "b"),
        file(pngBytes, "image/png", "shot.png")
      ]);
      const response = await serverWithLimits.app.inject({
        method: "POST",
        url: "/api/assets",
        payload: body,
        headers: { "content-type": contentType }
      });
      expect(response.statusCode).toBe(413);
      expect(apiError(response).code).toBe("ASSET_TOO_MANY_PARTS");
    } finally {
      await serverWithLimits.app.close();
    }
  });

  it("rejects files exceeding maxGlobalFileBytes with 413 ASSET_FILE_TOO_LARGE", async () => {
    const serverWithLimits = await initializeServer({
      workspaceRoot: await fs.mkdtemp(
        path.join(tmpdir(), "subdub-assets-limits-")
      ),
      assetUploadLimits: {
        ...DEFAULT_ASSET_UPLOAD_LIMITS,
        maxGlobalFileBytes: 1024
      }
    });
    try {
      const largePng = Buffer.alloc(2048);
      largePng.fill(0x89);
      largePng[0] = 0x89;
      largePng[1] = 0x50;
      largePng[2] = 0x4e;
      largePng[3] = 0x47;
      const { body, contentType } = buildMultipartBody([
        field("kind", "photo"),
        field("title", "t"),
        file(largePng, "image/png", "large.png")
      ]);
      const response = await serverWithLimits.app.inject({
        method: "POST",
        url: "/api/assets",
        payload: body,
        headers: { "content-type": contentType }
      });
      expect(response.statusCode).toBe(413);
      expect(apiError(response).code).toBe("ASSET_FILE_TOO_LARGE");
    } finally {
      await serverWithLimits.app.close();
    }
  });

  it("maps unexpected service failures to a safe 500 without internal details", async () => {
    const failingApp = (await import("../../src/api/app.js")).buildApp({
      assetService: {
        stageUpload: async () => {
          throw new Error("SQLITE failure at C:\\secret\\workspace\\subdub.db");
        },
        commitUpload: async () => {
          throw new Error("unused");
        },
        discardStaged: async () => {}
      } as never,
      staticRoot: undefined
    });
    try {
      const { body, contentType } = buildMultipartBody([
        field("kind", "photo"),
        field("title", "t"),
        file(pngBytes, "image/png", "shot.png")
      ]);
      const response = await failingApp.inject({
        method: "POST",
        url: "/api/assets",
        payload: body,
        headers: { "content-type": contentType }
      });
      expect(response.statusCode).toBe(500);
      expect(apiError(response).code).toBe("INTERNAL_SERVER_ERROR");
      expect(response.body).not.toContain("SQLITE");
      expect(response.body).not.toContain("C:\\secret");
      expect(response.body).not.toContain("Error: ");
    } finally {
      await failingApp.close();
    }
  });

  it("registers a valid upload even when the file part precedes the fields", async () => {
    const response = await upload([
      field("kind", "photo"),
      file(pngBytes, "image/png", "shot.png"),
      field("title", "後置タイトル")
    ]);
    expect(response.statusCode).toBe(200);
    const receipt = assetUploadResponseSchema.parse(response.json()).data;
    expect(receipt.title).toBe("後置タイトル");
    expect(receipt.status).toBe("processing");
  });

  it("returns 400 ASSET_INVALID_FIELD when sound_effect is missing a required usage tag", async () => {
    await insertTag("tag-a");
    const response = await upload([
      field("kind", "sound_effect"),
      field("title", "効果音"),
      field("tagIds", "tag-a"),
      file(wavBytes, "audio/wav", "effect.wav")
    ]);
    expect(response.statusCode).toBe(400);
    expect(apiError(response).code).toBe("ASSET_INVALID_FIELD");
  });

  it("returns detail for a registered asset with relative thumbnail paths", async () => {
    const uploadResponse = await upload([
      field("kind", "photo"),
      field("title", "取得テスト"),
      field("department", "部署"),
      file(pngBytes, "image/png", "shot.png")
    ]);
    expect(uploadResponse.statusCode).toBe(200);
    const receipt = assetUploadResponseSchema.parse(uploadResponse.json()).data;

    const detailResponse = await server.app.inject({
      method: "GET",
      url: `/api/assets/${receipt.assetId}`
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = assetDetailResponseSchema.parse(detailResponse.json()).data;
    expect(detail).toMatchObject({
      assetId: receipt.assetId,
      version: 1,
      kind: "photo",
      title: "取得テスト",
      status: "processing",
      checksum: null,
      sizeBytes: null,
      thumbnailPaths: []
    });
    expect(detail.department).toBe("部署");
  });

  it("returns processed metadata for an activated asset", async () => {
    const uploadResponse = await upload([
      field("kind", "photo"),
      field("title", "完了素材"),
      file(pngBytes, "image/png", "shot.png")
    ]);
    const receipt = assetUploadResponseSchema.parse(uploadResponse.json()).data;
    const checksum = createHash("sha256").update(pngBytes).digest("hex");
    const database = server.database.database;
    database
      .update(assetVersions)
      .set({
        checksum,
        sizeBytes: pngBytes.length,
        width: 64,
        height: 48,
        thumbnailPaths: JSON.stringify(["thumbnails/asset/v1/image.png"])
      })
      .where(
        and(
          eq(assetVersions.assetId, receipt.assetId),
          eq(assetVersions.version, 1)
        )
      )
      .run();
    database
      .update(assets)
      .set({ status: "active" })
      .where(eq(assets.assetId, receipt.assetId))
      .run();

    const detailResponse = await server.app.inject({
      method: "GET",
      url: `/api/assets/${receipt.assetId}`
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = assetDetailResponseSchema.parse(detailResponse.json()).data;
    expect(detail).toMatchObject({
      status: "active",
      checksum,
      sizeBytes: pngBytes.length,
      width: 64,
      height: 48,
      thumbnailPaths: ["thumbnails/asset/v1/image.png"]
    });
    for (const thumbnailPath of detail.thumbnailPaths) {
      expect(thumbnailPath).toMatch(/^thumbnails\//);
      expect(thumbnailPath).not.toContain("\\");
      expect(thumbnailPath).not.toMatch(/^[a-zA-Z]:/);
    }
  });

  it("returns 404 ASSET_NOT_FOUND for an unknown asset id", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/api/assets/does-not-exist"
    });
    expect(response.statusCode).toBe(404);
    expect(apiError(response).code).toBe("ASSET_NOT_FOUND");
  });
});
