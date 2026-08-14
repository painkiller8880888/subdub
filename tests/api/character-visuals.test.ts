import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { initializeServer } from "../../src/api/server.js";
import { characterVisualCatalogResponseSchema } from "../../src/schema/api.js";
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";

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

describe("character visual catalog routes", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it("returns the database snapshot through the read-only catalog API", async () => {
    await app.close();
    app = buildApp({
      characterVisualCatalogService: {
        list: () => catalogSnapshot,
        readManagedFile: async () => undefined
      }
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
      characterVisualCatalogService: {
        list: () => catalogSnapshot,
        readManagedFile
      }
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

  it("returns 404 for a file that is not in the catalog", async () => {
    await app.close();
    app = buildApp({
      characterVisualCatalogService: {
        list: () => catalogSnapshot,
        readManagedFile: async () => undefined
      }
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
    } finally {
      await initialized?.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
