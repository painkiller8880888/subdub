import { describe, expect, it, vi } from "vitest";

import { RenderManifestInputBuilder } from "../../src/app/rendering/render-manifest-compile-service.js";
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";
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
});
