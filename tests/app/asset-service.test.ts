import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { tags } from "../../src/db/schema.js";
import {
  AssetDatabaseError,
  AssetFileEmptyError,
  AssetFileTooLargeError,
  AssetFormatMismatchError,
  AssetInvalidFieldError,
  AssetTagNotFoundError,
  AssetUnsupportedFormatError
} from "../../src/app/assets/asset-errors.js";
import { AssetRepository } from "../../src/app/assets/asset-repository.js";
import { AssetService } from "../../src/app/assets/asset-service.js";
import {
  DEFAULT_ASSET_UPLOAD_LIMITS,
  type AssetUploadLimits
} from "../../src/app/assets/asset-upload-limits.js";
import type { AssetTagAxis } from "../../src/schema/asset.js";
import {
  jpegBytes,
  mp4Bytes,
  pdfBytes,
  pngBytes,
  wavBytes
} from "../fixtures/asset-fixtures.js";

type Fixture = {
  kind: "video" | "photo" | "document_scan" | "sound_effect";
  bytes: Buffer;
  mimeType: string;
  filename: string;
  extension: string;
};

const fixtures: Fixture[] = [
  {
    kind: "video",
    bytes: mp4Bytes,
    mimeType: "video/mp4",
    filename: "clip.mp4",
    extension: "mp4"
  },
  {
    kind: "photo",
    bytes: pngBytes,
    mimeType: "image/png",
    filename: "shot.png",
    extension: "png"
  },
  {
    kind: "photo",
    bytes: jpegBytes,
    mimeType: "image/jpeg",
    filename: "shot.jpg",
    extension: "jpg"
  },
  {
    kind: "document_scan",
    bytes: pdfBytes,
    mimeType: "application/pdf",
    filename: "scan.pdf",
    extension: "pdf"
  },
  {
    kind: "sound_effect",
    bytes: wavBytes,
    mimeType: "audio/wav",
    filename: "effect.wav",
    extension: "wav"
  }
];

describe("asset service", () => {
  let workspaceRoot: string;
  let db: Awaited<ReturnType<typeof initializeWorkspaceDatabase>> | undefined;
  let repository: AssetRepository;
  let service: AssetService;

  afterEach(async () => {
    if (db !== undefined) {
      db.close();
    }
    if (workspaceRoot !== undefined) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  async function createService(
    options: {
      createId?: () => string;
      limits?: AssetUploadLimits;
    } = {}
  ) {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-asset-service-")
    );
    db = await initializeWorkspaceDatabase({ workspaceRoot });
    repository = new AssetRepository(db.database);
    let nextId = 0;
    service = new AssetService({
      repository,
      managementRoot: path.join(workspaceRoot, "library"),
      now: () => new Date("2026-08-06T00:00:00.000Z"),
       createId: options.createId ?? ((() => {
           const id = `asset-test-${++nextId}`;
           console.log(`CREATE_ID CALLED: ${id}`);
           return id;
       })),
      limits: options.limits
    });
  }

  async function insertTag(
    tagId: string,
    axis: AssetTagAxis = "department",
    status: "active" | "inactive" = "active"
  ) {
    const now = "2026-08-06T00:00:00.000Z";
    db!.database
      .insert(tags)
      .values({
        tagId,
        axis,
        canonicalName: tagId,
        normalizedName: tagId,
        status,
        createdAt: now,
        updatedAt: now
      })
      .run();
  }

  function stagingDir(): string {
    return path.join(workspaceRoot, "library", "staging");
  }

  async function expectCleanFailureState(assetId: string): Promise<void> {
    expect(repository.findAsset(assetId)).toBeUndefined();
    const mediaDir = path.join(workspaceRoot, "library", "media", assetId);
    const mediaExists = await fs
      .access(mediaDir)
      .then(() => true)
      .catch(() => false);
    if (mediaExists) {
      expect(await fs.readdir(mediaDir)).toEqual([]);
    }
    expect(await fs.readdir(stagingDir())).toEqual([]);
  }

  async function register(
    fields: Record<string, unknown>,
    data: Buffer,
    mimeType: string,
    filename = "upload.bin"
  ) {
    const staged = await service.stageUpload({
      stream: Readable.from([data]),
      mimeType,
      filename
    });
    return service.commitUpload(fields, staged);
  }

  it("registers each allowed kind and persists processing rows and files", async () => {
    await createService();
    await insertTag("tag-a");
    await insertTag("tag-b", "system");

     for (const [index, fixture] of fixtures.entries()) {
        const receipt = await register(
          {
            kind: fixture.kind,
             title: "テストタイトル",
             description: "テスト説明",
             department: "テスト部署",
             system: "テストシステム",
            confidentiality: " confidential ",
            tagIds: ["tag-b", "tag-a", "tag-b"]
          },
          fixture.bytes,
          fixture.mimeType,
          fixture.filename
        );

         expect(receipt).toMatchObject({
           assetId: `asset-test-${index + 1}`,
           version: 1,
           kind: fixture.kind,
           title: "テストタイトル",
           description: "テスト説明",
           mimeType: fixture.mimeType,
           confidentiality: "confidential",
           department: "テスト部署",
           system: "テストシステム",
           status: "processing",
           tagIds: ["tag-b", "tag-a"]
         });
       expect(receipt.createdAt).toBe("2026-08-06T00:00:00.000Z");

      const asset = repository.findAsset(receipt.assetId);
       expect(asset).toMatchObject({
         assetId: receipt.assetId,
         kind: fixture.kind,
         title: "テストタイトル",
         status: "processing"
       });

      const version = repository.findAssetVersion(receipt.assetId, 1);
      expect(version).toMatchObject({
        assetId: receipt.assetId,
        version: 1,
        mimeType: fixture.mimeType,
        libraryMediaPath: `media/${receipt.assetId}/v1.${fixture.extension}`
      });
      expect(version?.checksum).toBeNull();
      expect(version?.width).toBeNull();
      expect(version?.durationMs).toBeNull();

      expect(repository.findAssetTagIds(receipt.assetId)).toEqual([
        "tag-a",
        "tag-b"
      ]);

      const stored = await fs.readFile(
        path.join(
          workspaceRoot,
          "library",
          `media/${receipt.assetId}/v1.${fixture.extension}`
        )
      );
      expect(stored.equals(fixture.bytes)).toBe(true);
    }

    expect(await fs.readdir(stagingDir())).toEqual([]);
  });

  it("rejects nonexistent and inactive tags without side effects", async () => {
    await createService();
    await insertTag("tag-active");
    await insertTag("tag-inactive", "department", "inactive");

    await expect(
      register(
        {
          kind: "sound_effect",
          title: "effect",
          tagIds: ["tag-active", "tag-missing"]
        },
        wavBytes,
        "audio/wav",
        "effect.wav"
      )
    ).rejects.toBeInstanceOf(AssetTagNotFoundError);
    await expect(
      register(
        { kind: "sound_effect", title: "effect", tagIds: ["tag-inactive"] },
        wavBytes,
        "audio/wav",
        "effect.wav"
      )
    ).rejects.toBeInstanceOf(AssetTagNotFoundError);
    await expectCleanFailureState("asset-test-1");
  });

  it("rejects empty files", async () => {
    await createService();
    await expect(
      register(
        { kind: "photo", title: "empty" },
        Buffer.alloc(0),
        "image/png",
        "empty.png"
      )
    ).rejects.toBeInstanceOf(AssetFileEmptyError);
    await expectCleanFailureState("asset-test-1");
  });

  it("rejects format, kind, and MIME mismatches and unsupported formats", async () => {
    await createService();
    const cases: Array<{
      kind: string;
      mimeType: string | undefined;
      data: Buffer;
      error: new () => unknown;
    }> = [
      {
        kind: "photo",
        mimeType: "image/png",
        data: pdfBytes,
        error: AssetFormatMismatchError
      },
      {
        kind: "video",
        mimeType: "video/mp4",
        data: wavBytes,
        error: AssetFormatMismatchError
      },
      {
        kind: "photo",
        mimeType: "image/png",
        data: jpegBytes,
        error: AssetFormatMismatchError
      },
      {
        kind: "photo",
        mimeType: "application/pdf",
        data: pngBytes,
        error: AssetFormatMismatchError
      },
      {
        kind: "photo",
        mimeType: "text/plain",
        data: pngBytes,
        error: AssetUnsupportedFormatError
      },
      {
        kind: "photo",
        mimeType: "image/png",
        data: Buffer.from("not a real file", "latin1"),
        error: AssetUnsupportedFormatError
      },
      {
        kind: "photo",
        mimeType: undefined,
        data: pngBytes,
        error: AssetUnsupportedFormatError
      },
      {
        kind: "photo",
        mimeType: "audio/x-wav",
        data: pngBytes,
        error: AssetFormatMismatchError
      }
    ];

    for (const testCase of cases) {
      await expect(
        register(
          { kind: testCase.kind, title: "t" },
          testCase.data,
          testCase.mimeType as string,
          "upload.bin"
        )
      ).rejects.toBeInstanceOf(testCase.error);
    }
    await expectCleanFailureState("asset-test-1");
  });

  it("does not trust client filenames for storage paths", async () => {
     await createService();
      const maliciousFilenames = [
        "../../../etc/passwd.png",
        "C:\\Windows\\system32\\pwn.png",
        "a/../b.png",
        "..\\..\\..\\evil.png",
        "社内 � 資料.png"
      ];
     for (let i = 0; i < maliciousFilenames.length; i++) {
       const filename = maliciousFilenames[i];
        const receipt = await register(
          { kind: "photo", title: "t" },
          pngBytes,
          "image/png",
          filename
        );
       expect(receipt.assetId).toBe(`asset-test-${i + 1}`);
       expect(
         repository.findAssetVersion(receipt.assetId, 1)?.libraryMediaPath
       ).toBe(`media/${receipt.assetId}/v1.png`);
     }

     await expect(
       register(
         { kind: "photo", title: "t" },
         pngBytes,
         "image/png",
         "x".repeat(256) + ".png"
       )
     ).rejects.toBeInstanceOf(AssetInvalidFieldError);
  });

  it("enforces per-kind file size limits", async () => {
    await createService({
      limits: {
        ...DEFAULT_ASSET_UPLOAD_LIMITS,
        perKindMaxBytes: {
          video: 2 * 1024 * 1024 * 1024,
          photo: 50,
          document_scan: 200 * 1024 * 1024,
          sound_effect: 200 * 1024 * 1024
        }
      }
    });
    await expect(
      register({ kind: "photo", title: "t" }, pngBytes, "image/png", "big.png")
    ).rejects.toBeInstanceOf(AssetFileTooLargeError);
    await expectCleanFailureState("asset-test-1");
  });

  it("streams uploads without buffering the whole file in memory", async () => {
    await createService();
    const total = 500 * 4096;
    const stream = Readable.from(
      Array.from({ length: 500 }, () => Buffer.alloc(4096, 7))
    );
    const staged = await service.stageUpload({
      stream,
      mimeType: "video/mp4",
      filename: "big.mp4"
    });
    expect(staged.bytes).toBe(total);
    const stored = await fs.stat(
      path.join(
        workspaceRoot,
        "library",
        staged.stagingRelativePath,
        "upload.bin"
      )
    );
    expect(stored.size).toBe(total);
    await service.discardStaged(staged);
    expect(await fs.readdir(stagingDir())).toEqual([]);
  });

  it("rolls back all inserts when a DB error occurs inside the transaction", async () => {
    await createService();
    const now = "2026-08-06T00:00:00.000Z";
    repository.insertAsset({
      assetId: "asset-test-1",
      kind: "video",
      title: "t",
      description: "",
      confidentiality: "internal",
      department: null,
      system: null,
      status: "processing",
      createdAt: now,
      updatedAt: now
    });
    repository.insertAssetVersion({
      assetId: "asset-test-1",
      version: 1,
      libraryMediaPath: "media/asset-test-1/v1.mp4",
      mimeType: "video/mp4",
      createdAt: now,
      updatedAt: now
    });

    expect(() =>
      repository.transaction((transaction) => {
        transaction.insertAsset({
          assetId: "asset-test-1",
          kind: "video",
          title: "duplicate",
          description: "",
          confidentiality: "internal",
          department: null,
          system: null,
          status: "processing",
          createdAt: now,
          updatedAt: now
        });
      })
    ).toThrow(AssetDatabaseError);

    const asset = repository.findAsset("asset-test-1");
    expect(asset?.title).toBe("t");
    const version = repository.findAssetVersion("asset-test-1", 1);
    expect(version?.libraryMediaPath).toBe("media/asset-test-1/v1.mp4");
  });

  it("cleans the moved media file when the DB insert fails after the move", async () => {
    await createService({
      createId: () => "asset-test-1"
    });
    const now = "2026-08-06T00:00:00.000Z";
    repository.insertAsset({
      assetId: "asset-test-1",
      kind: "video",
      title: "existing",
      description: "",
      confidentiality: "internal",
      department: null,
      system: null,
      status: "processing",
      createdAt: now,
      updatedAt: now
    });

    await expect(
      register({ kind: "video", title: "t" }, mp4Bytes, "video/mp4", "clip.mp4")
    ).rejects.toBeInstanceOf(AssetDatabaseError);
    await expect(
      fs.access(
        path.join(workspaceRoot, "library", "media", "asset-test-1", "v1.mp4")
      )
    ).rejects.toThrow();
    expect(await fs.readdir(stagingDir())).toEqual([]);
  });

  it("persists assets across a reopened database", async () => {
    await createService();
    await insertTag("tag-a");
    const receipt = await register(
      { kind: "photo", title: "persist", tagIds: ["tag-a"] },
      pngBytes,
      "image/png",
      "shot.png"
    );
    db!.close();
    db = undefined;

    const reopened = await initializeWorkspaceDatabase({ workspaceRoot });
    try {
      const reopenedRepository = new AssetRepository(reopened.database);
      const asset = reopenedRepository.findAsset(receipt.assetId);
      expect(asset?.status).toBe("processing");
      expect(asset?.title).toBe("persist");
      const version = reopenedRepository.findAssetVersion(receipt.assetId, 1);
      expect(version?.mimeType).toBe("image/png");
      expect(reopenedRepository.findAssetTagIds(receipt.assetId)).toEqual([
        "tag-a"
      ]);
    } finally {
      reopened.close();
    }
  });
});
