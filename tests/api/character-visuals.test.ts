import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { initializeServer } from "../../src/api/server.js";
import type { CharacterVisualCatalogServicePort } from "../../src/api/routes/character-visuals.js";
import { characterVisualCatalogResponseSchema } from "../../src/schema/api.js";
import {
  characterVisualCatalogSnapshotSchema,
  characterVisualSetSchema
} from "../../src/schema/character-visual.js";
import {
  apiErrorResponseSchema,
  characterVisualResponseSchema
} from "../../src/schema/api.js";
import {
  buildMultipartBody,
  makeTransparentPng,
  pngBytes
} from "../fixtures/asset-fixtures.js";

const catalogSnapshot = characterVisualCatalogSnapshotSchema.parse([
  {
    visualId: "character-mentor",
    name: "Mentor",
    description: "",
    status: "active",
    baseWidth: 600,
    baseHeight: 1000,
    variants: [
      {
        variantId: "character-mentor-stand-v1",
        label: "Stand",
        renderType: "single-image",
        tags: [],
        files: [
          {
            key: "single",
            libraryPath:
              "library/character-visuals/character-mentor/character-mentor-stand-v1/single.png",
            mimeType: "image/png",
            checksum: "0".repeat(64),
            sizeBytes: 3,
            width: 600,
            height: 1000
          }
        ]
      }
    ],
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z"
  }
]);

function makeCatalogService(
  overrides: Partial<CharacterVisualCatalogServicePort> = {}
): CharacterVisualCatalogServicePort {
  return {
    list: () => catalogSnapshot,
    get: (visualId) =>
      catalogSnapshot.find((visual) => visual.visualId === visualId),
    create: () => catalogSnapshot[0]!,
    update: () => catalogSnapshot[0]!,
    createVariant: async () => catalogSnapshot[0]!,
    updateVariant: async () => catalogSnapshot[0]!,
    deactivateVariant: () => catalogSnapshot[0]!,
    activateVariant: () => catalogSnapshot[0]!,
    stageUpload: async () => ({
      stagingRelativePath: "library/staging/test",
      fileRelativePath: "library/staging/test/upload.bin",
      sizeBytes: 0
    }),
    discardStaged: async () => undefined,
    readManagedFile: async () => undefined,
    readManagedFileByPath: async () => undefined,
    ...overrides
  };
}

describe("character visual catalog routes", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it("returns the database snapshot through the read-only catalog API", async () => {
    await app.close();
    app = buildApp({
      characterVisualCatalogService: makeCatalogService()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/character-visuals"
    });

    expect(response.statusCode).toBe(200);
    expect(
      characterVisualCatalogResponseSchema.parse(response.json()).data
    ).toEqual(catalogSnapshot);
  });

  it("serves a managed catalog file through its scoped URL", async () => {
    const readManagedFile = vi.fn(async () => ({
      content: Buffer.from("png"),
      mimeType: "image/png" as const
    }));
    await app.close();
    app = buildApp({
      characterVisualCatalogService: makeCatalogService({ readManagedFile })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/character-visuals/character-mentor/character-mentor-stand-v1/single"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.body).toBe("png");
    expect(readManagedFile).toHaveBeenCalledWith(
      "character-mentor",
      "character-mentor-stand-v1",
      "single"
    );
  });

  it("serves a manifest generation file by its exact managed path", async () => {
    const readManagedFileByPath = vi.fn(async () => ({
      content: Buffer.from("old-generation-png"),
      mimeType: "image/png" as const
    }));
    await app.close();
    app = buildApp({
      characterVisualCatalogService: makeCatalogService({
        readManagedFileByPath
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/character-visuals/character-mentor/character-mentor-stand-v1/generation-closed.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.body).toBe("old-generation-png");
    expect(readManagedFileByPath).toHaveBeenCalledWith(
      "character-mentor",
      "character-mentor-stand-v1",
      "generation-closed.png"
    );
  });

  it("returns 404 for a file that is not in the catalog", async () => {
    await app.close();
    app = buildApp({
      characterVisualCatalogService: makeCatalogService()
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/character-visuals/character-mentor/character-mentor-stand-v1/missing"
    });

    expect(response.statusCode).toBe(404);
  });

  it("wires the default server service to the SQLite-backed route", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visual-api-")
    );
    let initialized: Awaited<ReturnType<typeof initializeServer>> | undefined;
    try {
      initialized = await initializeServer({ workspaceRoot });
      const response = await initialized.app.inject({
        method: "GET",
        url: "/api/character-visuals"
      });

      expect(response.statusCode).toBe(200);
      const snapshot = characterVisualCatalogResponseSchema.parse(
        response.json()
      ).data;
      expect(snapshot).toHaveLength(2);
      expect(
        snapshot.reduce((count, visual) => count + visual.variants.length, 0)
      ).toBe(6);
      expect(
        snapshot.reduce(
          (count, visual) =>
            count +
            visual.variants.reduce(
              (variantCount, variant) => variantCount + variant.files.length,
              0
            ),
          0
        )
      ).toBe(10);

      const fileResponse = await initialized.app.inject({
        method: "GET",
        url: "/api/character-visuals/character-mentor/character-mentor-stand-v1/single"
      });
      expect(fileResponse.statusCode).toBe(200);
      expect(fileResponse.headers["content-type"]).toMatch(/^image\/png/);

      const exactFileResponse = await initialized.app.inject({
        method: "GET",
        url: "/api/character-visuals/character-mentor/character-mentor-stand-v1/single.png"
      });
      expect(exactFileResponse.statusCode).toBe(200);
      expect(exactFileResponse.headers["content-type"]).toMatch(/^image\/png/);
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("persists variant status through create, deactivate, reactivate, and update API calls", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visual-api-status-")
    );
    let initialized: Awaited<ReturnType<typeof initializeServer>> | undefined;
    try {
      initialized = await initializeServer({ workspaceRoot });
      const createResponse = await initialized.app.inject({
        method: "POST",
        url: "/api/character-visuals",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: "API status visual",
          description: "",
          status: "active",
          glowColor: "#123456"
        })
      });
      expect(createResponse.statusCode).toBe(200);
      const created = characterVisualResponseSchema.parse(
        createResponse.json()
      ).data;
      expect(created.variants).toEqual([]);
      expect(created.glowColor).toBe("#123456");

      const invalidGlowResponse = await initialized.app.inject({
        method: "POST",
        url: "/api/character-visuals",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: "Invalid glow visual",
          description: "",
          status: "active",
          glowColor: "#fff"
        })
      });
      expect(invalidGlowResponse.statusCode).toBe(422);

      const deactivateVisualResponse = await initialized.app.inject({
        method: "PUT",
        url: `/api/character-visuals/${created.visualId}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: "API status visual",
          description: "temporarily disabled",
          status: "inactive",
          glowColor: "#654321"
        })
      });
      expect(deactivateVisualResponse.statusCode).toBe(200);
      expect(
        characterVisualResponseSchema.parse(deactivateVisualResponse.json())
          .data.status
      ).toBe("inactive");
      expect(
        characterVisualResponseSchema.parse(deactivateVisualResponse.json())
          .data.glowColor
      ).toBe("#654321");

      const reactivateVisualResponse = await initialized.app.inject({
        method: "PUT",
        url: `/api/character-visuals/${created.visualId}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: "API status visual",
          description: "",
          status: "active"
        })
      });
      expect(reactivateVisualResponse.statusCode).toBe(200);
      expect(
        characterVisualResponseSchema.parse(reactivateVisualResponse.json())
          .data.glowColor
      ).toBe("#654321");

      const multipart = buildMultipartBody([
        { name: "label", value: "API status variant" },
        { name: "renderType", value: "single-image" },
        { name: "tags", value: "api" },
        {
          name: "single",
          filename: "client-name.png",
          mimeType: "image/png",
          data: pngBytes
        }
      ]);
      const variantResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${created.visualId}/variants`,
        headers: { "content-type": multipart.contentType },
        payload: multipart.body
      });
      expect(variantResponse.statusCode).toBe(200);
      const withVariant = characterVisualResponseSchema.parse(
        variantResponse.json()
      ).data;
      const variantId = withVariant.variants[0]!.variantId;
      expect(withVariant.variants[0]?.status).toBe("active");

      const deactivateResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${created.visualId}/variants/${variantId}/deactivate`
      });
      expect(deactivateResponse.statusCode).toBe(200);
      const inactive = characterVisualResponseSchema.parse(
        deactivateResponse.json()
      ).data;
      expect(inactive.variants[0]?.status).toBe("inactive");
      expect(
        initialized.database.connection
          .prepare("SELECT COUNT(*) AS count FROM character_variants")
          .get()
      ).toEqual({ count: 7 });

      const listed = characterVisualCatalogResponseSchema.parse(
        (
          await initialized.app.inject({
            method: "GET",
            url: "/api/character-visuals"
          })
        ).json()
      ).data;
      expect(
        listed.find((visual) => visual.visualId === created.visualId)
          ?.variants[0]?.status
      ).toBe("inactive");

      const activateResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${created.visualId}/variants/${variantId}/activate`
      });
      expect(activateResponse.statusCode).toBe(200);
      const active = characterVisualResponseSchema.parse(
        activateResponse.json()
      ).data;
      expect(active.variants[0]?.status).toBe("active");

      const updateMultipart = buildMultipartBody([
        { name: "label", value: "API status variant updated" },
        { name: "renderType", value: "single-image" },
        {
          name: "single",
          filename: "another-client-name.png",
          mimeType: "image/png",
          data: pngBytes
        }
      ]);
      const updateResponse = await initialized.app.inject({
        method: "PUT",
        url: `/api/character-visuals/${created.visualId}/variants/${variantId}`,
        headers: { "content-type": updateMultipart.contentType },
        payload: updateMultipart.body
      });
      expect(updateResponse.statusCode).toBe(200);
      expect(
        characterVisualResponseSchema.parse(updateResponse.json()).data
          .variants[0]?.label
      ).toBe("API status variant updated");
      characterVisualSetSchema.parse(
        characterVisualResponseSchema.parse(updateResponse.json()).data
      );
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("restarts with mutable seed visual and variant data intact", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visual-api-restart-")
    );
    let initialized: Awaited<ReturnType<typeof initializeServer>> | undefined;
    try {
      initialized = await initializeServer({ workspaceRoot });
      const initial = characterVisualCatalogResponseSchema.parse(
        (
          await initialized.app.inject({
            method: "GET",
            url: "/api/character-visuals"
          })
        ).json()
      ).data;
      const visual = initial.find(
        (candidate) => candidate.visualId === "character-mentor"
      )!;
      const variant = visual.variants.find(
        (candidate) => candidate.variantId === "character-mentor-stand-v1"
      )!;
      const oldLibraryPath = variant.files[0]!.libraryPath;

      const visualUpdate = await initialized.app.inject({
        method: "PUT",
        url: `/api/character-visuals/${visual.visualId}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          name: "Customized mentor",
          description: "Customized seed description",
          status: "inactive"
        })
      });
      expect(visualUpdate.statusCode).toBe(200);

      const replacement = makeTransparentPng(600, 1000, 1);
      const variantUpdate = buildMultipartBody([
        { name: "label", value: "Customized stand" },
        { name: "renderType", value: "single-image" },
        { name: "tags", value: "custom" },
        {
          name: "single",
          filename: "customized.png",
          mimeType: "image/png",
          data: replacement
        }
      ]);
      const variantResponse = await initialized.app.inject({
        method: "PUT",
        url: `/api/character-visuals/${visual.visualId}/variants/${variant.variantId}`,
        headers: { "content-type": variantUpdate.contentType },
        payload: variantUpdate.body
      });
      expect(variantResponse.statusCode).toBe(200);

      await initialized.app.close();
      initialized = undefined;
      initialized = await initializeServer({ workspaceRoot });

      const restarted = characterVisualCatalogResponseSchema.parse(
        (
          await initialized.app.inject({
            method: "GET",
            url: "/api/character-visuals"
          })
        ).json()
      ).data;
      const restartedVisual = restarted.find(
        (candidate) => candidate.visualId === visual.visualId
      )!;
      const restartedVariant = restartedVisual.variants.find(
        (candidate) => candidate.variantId === variant.variantId
      )!;
      expect(restartedVisual).toMatchObject({
        name: "Customized mentor",
        description: "Customized seed description",
        status: "inactive"
      });
      expect(restartedVariant).toMatchObject({
        label: "Customized stand",
        renderType: "single-image",
        tags: ["custom"]
      });
      expect(restartedVariant.files[0]!.libraryPath).not.toBe(oldLibraryPath);
      await expect(
        fs.stat(path.join(workspaceRoot, oldLibraryPath))
      ).rejects.toMatchObject({ code: "ENOENT" });

      const fileResponse = await initialized.app.inject({
        method: "GET",
        url: `/api/character-visuals/${visual.visualId}/${variant.variantId}/single`
      });
      expect(fileResponse.statusCode).toBe(200);
      expect([...fileResponse.rawPayload]).toEqual([...replacement]);
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("validates invalid PNG, missing pair slots, and canvas mismatch through multipart", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visual-api-validation-")
    );
    let initialized: Awaited<ReturnType<typeof initializeServer>> | undefined;
    try {
      initialized = await initializeServer({ workspaceRoot });
      const createVisual = async (name: string) => {
        const response = await initialized!.app.inject({
          method: "POST",
          url: "/api/character-visuals",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ name, description: "", status: "active" })
        });
        return characterVisualResponseSchema.parse(response.json()).data;
      };

      const invalidPngVisual = await createVisual("Invalid PNG visual");
      const invalidPng = buildMultipartBody([
        { name: "label", value: "Invalid" },
        { name: "renderType", value: "single-image" },
        {
          name: "single",
          filename: "invalid.png",
          mimeType: "image/png",
          data: Buffer.from("not a png")
        }
      ]);
      const invalidResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${invalidPngVisual.visualId}/variants`,
        headers: { "content-type": invalidPng.contentType },
        payload: invalidPng.body
      });
      expect(invalidResponse.statusCode).toBe(422);
      expect(
        apiErrorResponseSchema.parse(invalidResponse.json()).error.code
      ).toBe("CHARACTER_VISUAL_INVALID_PNG");

      const missingPairVisual = await createVisual("Missing pair visual");
      const missingPair = buildMultipartBody([
        { name: "label", value: "Missing pair" },
        { name: "renderType", value: "mouth-pair" },
        {
          name: "closed",
          filename: "closed.png",
          mimeType: "image/png",
          data: makeTransparentPng(1, 1)
        }
      ]);
      const missingPairResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${missingPairVisual.visualId}/variants`,
        headers: { "content-type": missingPair.contentType },
        payload: missingPair.body
      });
      expect(missingPairResponse.statusCode).toBe(422);
      expect(
        apiErrorResponseSchema.parse(missingPairResponse.json()).error.code
      ).toBe("CHARACTER_VISUAL_MISSING_SLOT");

      const mismatchVisual = await createVisual("Canvas mismatch visual");
      const mismatch = buildMultipartBody([
        { name: "label", value: "Canvas mismatch" },
        { name: "renderType", value: "mouth-pair" },
        {
          name: "closed",
          filename: "closed.png",
          mimeType: "image/png",
          data: makeTransparentPng(1, 1)
        },
        {
          name: "open",
          filename: "open.png",
          mimeType: "image/png",
          data: makeTransparentPng(2, 1)
        }
      ]);
      const mismatchResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/character-visuals/${mismatchVisual.visualId}/variants`,
        headers: { "content-type": mismatch.contentType },
        payload: mismatch.body
      });
      expect(mismatchResponse.statusCode).toBe(422);
      expect(
        apiErrorResponseSchema.parse(mismatchResponse.json()).error.code
      ).toBe("CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH");
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not stage uploads for missing visual or variant targets", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-visual-api-missing-target-")
    );
    let initialized: Awaited<ReturnType<typeof initializeServer>> | undefined;
    try {
      initialized = await initializeServer({ workspaceRoot });
      const multipart = buildMultipartBody([
        { name: "label", value: "Unused" },
        { name: "renderType", value: "single-image" },
        {
          name: "single",
          filename: "unused.png",
          mimeType: "image/png",
          data: pngBytes
        }
      ]);

      const missingVisualResponse = await initialized.app.inject({
        method: "POST",
        url: "/api/character-visuals/not-exist/variants",
        headers: { "content-type": multipart.contentType },
        payload: multipart.body
      });
      expect(missingVisualResponse.statusCode).toBe(404);

      const missingVariantResponse = await initialized.app.inject({
        method: "PUT",
        url: "/api/character-visuals/character-mentor/variants/not-exist",
        headers: { "content-type": multipart.contentType },
        payload: multipart.body
      });
      expect(missingVariantResponse.statusCode).toBe(404);

      const stagingEntries = await fs.readdir(
        path.join(workspaceRoot, "library", "staging")
      );
      expect(
        stagingEntries.filter((entry) =>
          entry.startsWith("character-visual-upload-")
        )
      ).toEqual([]);
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
