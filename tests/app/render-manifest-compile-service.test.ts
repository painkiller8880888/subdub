import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { legacyCharacterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import { RenderManifestInputBuilder } from "../../src/app/rendering/render-manifest-compile-service.js";
import {
  compileRenderManifest,
  type RenderManifestAssetMetadata
} from "../../src/app/rendering/render-manifest-compiler.js";
import { assetDetailSchema } from "../../src/schema/asset.js";
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";
import type { VideoProject } from "../../src/schema/index.js";
import { mp4Bytes, pngBytes } from "../fixtures/asset-fixtures.js";
import {
  createRenderManifestAudioIndex,
  createRenderManifestInput
} from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import { mediaFixture } from "../fixtures/media-fixtures.js";

const snapshot = characterVisualCatalogSnapshotSchema.parse([
  {
    visualId: "visual-custom",
    name: "Custom",
    description: "",
    status: "active",
    baseWidth: 600,
    baseHeight: 1000,
    variants: [
      {
        variantId: "visual-custom-stand-v1",
        label: "Stand",
        renderType: "single-image",
        status: "active",
        tags: [],
        files: [
          {
            key: "single",
            libraryPath:
              "library/character-visuals/visual-custom/visual-custom-stand-v1/single.png",
            mimeType: "image/png",
            checksum: "a".repeat(64),
            sizeBytes: 1,
            width: 600,
            height: 1000
          }
        ]
      }
    ],
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z"
  }
]);

function createLegacySnapshot() {
  const visualIds = [
    ...new Set(
      legacyCharacterVariantCatalog.map((variant) => variant.characterId)
    )
  ];
  return characterVisualCatalogSnapshotSchema.parse(
    visualIds.map((visualId) => ({
      visualId,
      name: visualId,
      description: "",
      status: "active",
      baseWidth: 600,
      baseHeight: 1000,
      variants: legacyCharacterVariantCatalog
        .filter((variant) => variant.characterId === visualId)
        .map((variant, variantIndex) => ({
          variantId: variant.variantId,
          label: variant.label,
          renderType: variant.renderType,
          status: "active",
          tags: [...variant.tags],
          files: variant.files.map((file, fileIndex) => ({
            key: file.key,
            libraryPath: `library/character-visuals/${visualId}/${variant.variantId}/${file.key}.png`,
            mimeType: "image/png",
            checksum:
              `${String(variantIndex + 1)}${String(fileIndex + 1)}`.padStart(
                64,
                "c"
              ),
            sizeBytes: 1,
            width: 600,
            height: 1000
          }))
        })),
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    }))
  );
}

describe("RenderManifestInputBuilder", () => {
  it("uses the verified SQLite snapshot and carries file checksums forward", async () => {
    const project = structuredClone(videoProjectFixture);
    const audioIndex = createRenderManifestAudioIndex(project);
    const verifyFiles = vi.fn(async () => snapshot);
    const builder = new RenderManifestInputBuilder({
      workspaceRoot: "C:\\workspace",
      projectRepository: { read: async () => project },
      assetRepository: { findAssetDetail: () => undefined },
      characterVisualCatalogService: { verifyFiles },
      audioStore: { readIndex: async () => audioIndex }
    });

    const input = await builder.build(project.metadata.id);

    expect(verifyFiles).toHaveBeenCalledTimes(1);
    expect(input.characterVariantCatalog).toBe(snapshot);
    expect(input.assetMetadata).toEqual(
      expect.arrayContaining([
        {
          path: "library/character-visuals/visual-custom/visual-custom-stand-v1/single.png",
          kind: "character",
          sha256: "a".repeat(64)
        }
      ])
    );
  });

  it("collects an image background and compiles the verified fixture input", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-manifest-input-builder-")
    );
    try {
      const project = structuredClone(videoProjectFixture);
      project.script.outlineHash = computeOutlineHash(project.outline);
      project.visuals.assignments = [];
      project.edit.sectionBgms = [];
      project.audio.soundEffects = [];
      const mainSection = project.script.sections[1];
      const introSection = project.script.sections[0];
      if (
        mainSection === undefined ||
        introSection === undefined ||
        mainSection.background.kind !== "image"
      ) {
        throw new Error("The fixture image background is missing.");
      }
      introSection.background = mainSection.background;

      const backgroundPath = path.join(
        workspaceRoot,
        "projects",
        project.metadata.id,
        ..."backgrounds/application-system.png".split("/")
      );
      const backgroundContents = pngBytes;
      await fs.mkdir(path.dirname(backgroundPath), { recursive: true });
      await fs.writeFile(backgroundPath, backgroundContents);

      const audioIndex = createRenderManifestAudioIndex(project);
      const builder = new RenderManifestInputBuilder({
        workspaceRoot,
        projectRepository: { read: async () => project },
        assetRepository: { findAssetDetail: () => undefined },
        characterVisualCatalogService: {
          verifyFiles: async () => createLegacySnapshot()
        },
        audioStore: { readIndex: async () => audioIndex }
      });

      const input = await builder.build(project.metadata.id);
      const expectedBackgroundChecksum = createHash("sha256")
        .update(backgroundContents)
        .digest("hex");
      expect(input.assetMetadata).toEqual(
        expect.arrayContaining([
          {
            path: "backgrounds/application-system.png",
            kind: "image",
            sha256: expectedBackgroundChecksum
          }
        ])
      );
      const assetMetadata = (input.assetMetadata ??
        []) as readonly RenderManifestAssetMetadata[];
      expect(
        assetMetadata.filter(
          (asset) => asset.path === "backgrounds/application-system.png"
        )
      ).toHaveLength(1);

      const result = compileRenderManifest(input);
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.manifest.sourceAssetChecksums).toEqual(
        expect.arrayContaining([
          {
            path: "backgrounds/application-system.png",
            sha256: expectedBackgroundChecksum
          }
        ])
      );
      expect(
        result.manifest.sourceAssetChecksums.filter(
          (asset) => asset.path === "backgrounds/application-system.png"
        )
      ).toHaveLength(1);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("collects edit video checksum, metadata, and detected format from the project file", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-edit-video-input-builder-")
    );
    try {
      const project = structuredClone(videoProjectFixture) as VideoProject;
      const contents = mp4Bytes;
      const checksum = createHash("sha256").update(contents).digest("hex");
      project.edit.videoElements = [
        {
          id: "edit-intro",
          role: "intro",
          assetId: "asset-edit-video",
          assetVersion: 2,
          assetChecksum: checksum,
          projectMediaPath: "media/edits/intro.mp4",
          placement: { kind: "before_first_section" },
          volume: 0.25
        }
      ];
      const filePath = path.join(
        workspaceRoot,
        "projects",
        project.metadata.id,
        ...project.edit.videoElements[0].projectMediaPath.split("/")
      );
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);

      const detail = assetDetailSchema.parse({
        assetId: "asset-edit-video",
        version: 2,
        kind: "video",
        title: "Edit video",
        description: "",
        confidentiality: "internal",
        department: null,
        system: null,
        mimeType: "video/mp4",
        libraryMediaPath: "library/edit-video.mp4",
        checksum,
        sizeBytes: contents.length,
        width: 1920,
        height: 1080,
        durationMs: 2_500,
        pageCount: null,
        thumbnailPaths: [],
        status: "active",
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z"
      });
      const findAssetDetail = vi.fn((assetId: string, version?: number) =>
        assetId === "asset-edit-video" && version === 2 ? detail : undefined
      );
      const audioIndex = createRenderManifestAudioIndex(project);
      const builder = new RenderManifestInputBuilder({
        workspaceRoot,
        projectRepository: { read: async () => project },
        assetRepository: { findAssetDetail },
        characterVisualCatalogService: {
          verifyFiles: async () => createLegacySnapshot()
        },
        audioStore: { readIndex: async () => audioIndex }
      });

      const input = await builder.build(project.metadata.id);
      const editMetadata = (
        input.assetMetadata as readonly RenderManifestAssetMetadata[]
      ).find((asset) => asset.path === "media/edits/intro.mp4");
      expect(editMetadata).toEqual({
        path: "media/edits/intro.mp4",
        kind: "video",
        sha256: checksum,
        durationMs: 2_500,
        mimeType: "video/mp4",
        format: "mp4"
      });
      expect(findAssetDetail).toHaveBeenCalledWith("asset-edit-video", 2);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("collects BGM registration, snapshot checksum, MIME, and detected format", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-bgm-input-builder-")
    );
    try {
      const project = structuredClone(videoProjectFixture) as VideoProject;
      const contents = await mediaFixture("bgm-1s.mp3");
      const checksum = createHash("sha256").update(contents).digest("hex");
      project.edit.sectionBgms = [
        {
          id: "bgm-selected",
          sectionId: "section-intro",
          assetId: "asset-bgm-selected",
          assetVersion: 3,
          assetChecksum: checksum,
          projectMediaPath: "audio/bgm/selected.mp3",
          volume: 0.5
        }
      ];
      const filePath = path.join(
        workspaceRoot,
        "projects",
        project.metadata.id,
        ...project.edit.sectionBgms[0].projectMediaPath.split("/")
      );
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);

      const detail = assetDetailSchema.parse({
        assetId: "asset-bgm-selected",
        version: 3,
        kind: "bgm",
        title: "Selected BGM",
        description: "",
        confidentiality: "internal",
        department: null,
        system: null,
        mimeType: "audio/mpeg",
        libraryMediaPath: "media/asset-bgm-selected.mp3",
        checksum,
        sizeBytes: contents.length,
        width: null,
        height: null,
        durationMs: 1_045,
        pageCount: null,
        thumbnailPaths: [],
        status: "active",
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z"
      });
      const findAssetDetail = vi.fn((assetId: string, version?: number) =>
        assetId === detail.assetId && version === detail.version
          ? detail
          : undefined
      );
      const audioIndex = createRenderManifestAudioIndex(project);
      const builder = new RenderManifestInputBuilder({
        workspaceRoot,
        projectRepository: { read: async () => project },
        assetRepository: { findAssetDetail },
        characterVisualCatalogService: {
          verifyFiles: async () => createLegacySnapshot()
        },
        audioStore: { readIndex: async () => audioIndex }
      });

      const input = await builder.build(project.metadata.id);
      const bgmMetadata = (
        input.assetMetadata as readonly RenderManifestAssetMetadata[]
      ).find((asset) => asset.path === "audio/bgm/selected.mp3");
      expect(bgmMetadata).toEqual({
        path: "audio/bgm/selected.mp3",
        kind: "bgm",
        sha256: checksum,
        durationMs: expect.any(Number),
        mimeType: "audio/mpeg",
        format: "mp3"
      });
      expect(findAssetDetail).toHaveBeenCalledWith("asset-bgm-selected", 3);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "missing asset",
      detail: undefined,
      expectedCode: "ASSET_METADATA_MISSING"
    },
    {
      name: "wrong version",
      detail: "version-mismatch",
      requestedVersion: 2,
      expectedCode: "ASSET_METADATA_MISSING"
    },
    {
      name: "wrong kind",
      detail: "kind-mismatch",
      expectedCode: "ASSET_KIND_MISMATCH"
    },
    {
      name: "inactive asset",
      detail: "inactive",
      expectedCode: "ASSET_METADATA_MISSING"
    },
    {
      name: "wrong MIME",
      detail: "mime-mismatch",
      expectedCode: "EDIT_BGM_FORMAT_INVALID"
    }
  ])(
    "rejects production BGM compile when the DB has $name",
    async ({ detail: detailCase, requestedVersion, expectedCode }) => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(tmpdir(), "subdub-bgm-validation-")
      );
      try {
        const project = structuredClone(videoProjectFixture) as VideoProject;
        const contents = await mediaFixture("bgm-1s.mp3");
        const checksum = createHash("sha256").update(contents).digest("hex");
        const assetVersion = requestedVersion ?? 1;
        project.edit.sectionBgms = [
          {
            id: "bgm-selected",
            sectionId: "section-intro",
            assetId: "asset-bgm-selected",
            assetVersion,
            assetChecksum: checksum,
            projectMediaPath: "audio/bgm/selected.mp3",
            volume: 0.5
          }
        ];
        const filePath = path.join(
          workspaceRoot,
          "projects",
          project.metadata.id,
          ...project.edit.sectionBgms[0].projectMediaPath.split("/")
        );
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents);

        const detail =
          detailCase === undefined
            ? undefined
            : assetDetailSchema.parse({
                assetId: "asset-bgm-selected",
                version: detailCase === "version-mismatch" ? 1 : 1,
                kind: detailCase === "kind-mismatch" ? "video" : "bgm",
                title: "Selected BGM",
                description: "",
                confidentiality: "internal",
                department: null,
                system: null,
                mimeType:
                  detailCase === "mime-mismatch"
                    ? "audio/wav"
                    : detailCase === "kind-mismatch"
                      ? "video/mp4"
                      : "audio/mpeg",
                libraryMediaPath: "media/asset-bgm-selected.mp3",
                checksum,
                sizeBytes: contents.length,
                width: null,
                height: null,
                durationMs: 1_045,
                pageCount: null,
                thumbnailPaths: [],
                status: detailCase === "inactive" ? "inactive" : "active",
                errorCode: null,
                errorMessage: null,
                createdAt: "2026-08-15T00:00:00.000Z",
                updatedAt: "2026-08-15T00:00:00.000Z"
              });
        const findAssetDetail = vi.fn((assetId: string, version?: number) =>
          detail !== undefined &&
          assetId === detail.assetId &&
          version === detail.version
            ? detail
            : undefined
        );
        const audioIndex = createRenderManifestAudioIndex(project);
        const builder = new RenderManifestInputBuilder({
          workspaceRoot,
          projectRepository: { read: async () => project },
          assetRepository: { findAssetDetail },
          characterVisualCatalogService: {
            verifyFiles: async () => createLegacySnapshot()
          },
          audioStore: { readIndex: async () => audioIndex }
        });
        const built = await builder.build(project.metadata.id);
        const baseInput = createRenderManifestInput(project);
        const bgmPath = "audio/bgm/selected.mp3";
        const baseMetadata = (
          baseInput.assetMetadata as readonly RenderManifestAssetMetadata[]
        ).filter((asset) => asset.path !== bgmPath);
        const builtBgmMetadata = (
          built.assetMetadata as readonly RenderManifestAssetMetadata[]
        ).filter((asset) => asset.path === bgmPath);
        const result = compileRenderManifest({
          ...baseInput,
          assetMetadata: [...baseMetadata, ...builtBgmMetadata]
        });

        expect(result.success).toBe(false);
        if (result.success) {
          return;
        }
        expect(
          result.diagnostics.map((diagnostic) => diagnostic.code)
        ).toContain(expectedCode);
      } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      }
    }
  );

  it.each([
    {
      name: "inactive asset",
      status: "inactive" as const,
      checksum: "matches" as const
    },
    {
      name: "DB checksum mismatch",
      status: "active" as const,
      checksum: "mismatch" as const
    }
  ])(
    "rejects production edit video compile when the DB has $name",
    async ({ status, checksum: checksumCase }) => {
      const workspaceRoot = await fs.mkdtemp(
        path.join(tmpdir(), "subdub-edit-video-validation-")
      );
      try {
        const project = structuredClone(videoProjectFixture) as VideoProject;
        const contents = mp4Bytes;
        const projectChecksum = createHash("sha256")
          .update(contents)
          .digest("hex");
        const projectMediaPath = "media/edits/intro.mp4";
        project.edit.videoElements = [
          {
            id: "edit-intro",
            role: "intro",
            assetId: "asset-edit-video",
            assetVersion: 2,
            assetChecksum: projectChecksum,
            projectMediaPath,
            placement: { kind: "before_first_section" },
            volume: 0.25
          }
        ];
        const filePath = path.join(
          workspaceRoot,
          "projects",
          project.metadata.id,
          ...projectMediaPath.split("/")
        );
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents);

        const detail = assetDetailSchema.parse({
          assetId: "asset-edit-video",
          version: 2,
          kind: "video",
          title: "Edit video",
          description: "",
          confidentiality: "internal",
          department: null,
          system: null,
          mimeType: "video/mp4",
          libraryMediaPath: "library/edit-video.mp4",
          checksum:
            checksumCase === "mismatch" ? "f".repeat(64) : projectChecksum,
          sizeBytes: contents.length,
          width: 1920,
          height: 1080,
          durationMs: 2_500,
          pageCount: null,
          thumbnailPaths: [],
          status,
          errorCode: null,
          errorMessage: null,
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z"
        });
        const findAssetDetail = vi.fn((assetId: string, version?: number) =>
          assetId === detail.assetId && version === detail.version
            ? detail
            : undefined
        );
        const audioIndex = createRenderManifestAudioIndex(project);
        const builder = new RenderManifestInputBuilder({
          workspaceRoot,
          projectRepository: { read: async () => project },
          assetRepository: { findAssetDetail },
          characterVisualCatalogService: {
            verifyFiles: async () => createLegacySnapshot()
          },
          audioStore: { readIndex: async () => audioIndex }
        });

        const built = await builder.build(project.metadata.id);
        const baseInput = createRenderManifestInput(project);
        const baseMetadata = (
          baseInput.assetMetadata as readonly RenderManifestAssetMetadata[]
        ).filter((asset) => asset.path !== projectMediaPath);
        const builtEditMetadata = (
          built.assetMetadata as readonly RenderManifestAssetMetadata[]
        ).filter((asset) => asset.path === projectMediaPath);
        const result = compileRenderManifest({
          ...baseInput,
          assetMetadata: [...baseMetadata, ...builtEditMetadata]
        });

        expect(result.success).toBe(false);
        if (result.success) {
          return;
        }
        expect(
          result.diagnostics.map((diagnostic) => diagnostic.code)
        ).toContain("ASSET_METADATA_MISSING");
      } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
      }
    }
  );
});
