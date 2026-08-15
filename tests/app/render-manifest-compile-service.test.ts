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
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";
import { pngBytes } from "../fixtures/asset-fixtures.js";
import { createRenderManifestAudioIndex } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

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
      project.audio.sectionBgms = [];
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
});
