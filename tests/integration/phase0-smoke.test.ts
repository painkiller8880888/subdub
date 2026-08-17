import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureWorkspaceDirectories,
  initializeServer
} from "../../src/api/server.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import { SQLITE_BUSY_TIMEOUT_MS } from "../../src/db/connection.js";
import {
  apiSuccessResponseSchema,
  videoProjectSchema
} from "../../src/schema/index.js";
import { createEmptyVideoProject } from "../fixtures/empty-video-project.js";

const PROJECT_ID = "phase-zero-empty";
const CREATED_AT = "2026-08-03T00:00:00.000Z";
const SAVED_AT = "2026-08-03T00:01:00.000Z";

function migrationHistory(connection: {
  prepare(source: string): { all(): unknown[] };
}): Array<Record<string, unknown>> {
  return connection
    .prepare(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY id"
    )
    .all()
    .map((row) => row as Record<string, unknown>);
}

describe("Phase 0 integration smoke", () => {
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaceRoots
        .splice(0)
        .map((workspaceRoot) =>
          fs.rm(workspaceRoot, { recursive: true, force: true })
        )
    );
  });

  it("joins workspace setup, project persistence, migrations, and API health", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-phase0-smoke-")
    );
    workspaceRoots.push(workspaceRoot);

    const projectFile = path.join(
      workspaceRoot,
      "projects",
      PROJECT_ID,
      "project.json"
    );
    const emptyProject = createEmptyVideoProject({
      projectId: PROJECT_ID,
      createdAt: CREATED_AT
    });

    await ensureWorkspaceDirectories(workspaceRoot);
    await expect(
      fs.stat(path.join(workspaceRoot, "projects"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(workspaceRoot, "library"))
    ).resolves.toBeDefined();
    await expect(fs.access(projectFile)).rejects.toThrow();
    expect(videoProjectSchema.parse(emptyProject)).toEqual(emptyProject);

    const firstDatabase = await initializeWorkspaceDatabase({ workspaceRoot });
    let firstHistory: Array<Record<string, unknown>>;
    try {
      firstHistory = migrationHistory(firstDatabase.connection);
      expect(firstDatabase.migrationResult.applied).toBe(true);
      expect(firstHistory).toHaveLength(11);
      expect(
        firstDatabase.connection.pragma("foreign_keys", { simple: true })
      ).toBe(1);
      expect(
        String(
          firstDatabase.connection.pragma("journal_mode", { simple: true })
        ).toLowerCase()
      ).toBe("wal");
      expect(
        firstDatabase.connection.pragma("busy_timeout", { simple: true })
      ).toBe(SQLITE_BUSY_TIMEOUT_MS);
    } finally {
      firstDatabase.close();
    }
    expect(firstDatabase.connection.open).toBe(false);

    const repository = new ProjectRepository({
      workspaceRoot,
      now: () => new Date(SAVED_AT)
    });
    const created = await repository.create(emptyProject);
    expect(created).toEqual(emptyProject);
    expect(videoProjectSchema.parse(created)).toEqual(created);
    await expect(fs.readFile(projectFile)).resolves.toEqual(
      Buffer.from(`${JSON.stringify(emptyProject, null, 2)}\n`, "utf8")
    );
    const bytesAfterCreate = await fs.readFile(projectFile);
    await expect(repository.create(emptyProject)).rejects.toMatchObject({
      code: "PROJECT_ALREADY_EXISTS",
      status: 409
    });
    await expect(fs.readFile(projectFile)).resolves.toEqual(bytesAfterCreate);

    const reloaded = await repository.read(PROJECT_ID);
    expect(reloaded).toEqual(created);

    const changed = {
      ...reloaded,
      metadata: {
        ...reloaded.metadata,
        title: "Updated empty project"
      }
    };
    const updated = await repository.save(
      PROJECT_ID,
      changed,
      reloaded.revision
    );
    expect(updated.revision).toBe(reloaded.revision + 1);
    expect(updated.metadata.title).toBe("Updated empty project");
    expect(updated.metadata.updatedAt).toBe(SAVED_AT);
    expect(await repository.read(PROJECT_ID)).toEqual(updated);

    const bytesBeforeConflict = await fs.readFile(projectFile);
    const staleCandidate = {
      ...reloaded,
      metadata: {
        ...reloaded.metadata,
        title: "Stale update"
      }
    };
    await expect(
      repository.save(PROJECT_ID, staleCandidate, reloaded.revision)
    ).rejects.toMatchObject({
      code: "PROJECT_REVISION_CONFLICT",
      status: 409
    });
    await expect(fs.readFile(projectFile)).resolves.toEqual(
      bytesBeforeConflict
    );

    const secondDatabase = await initializeWorkspaceDatabase({ workspaceRoot });
    try {
      expect(secondDatabase.migrationResult.applied).toBe(false);
      expect(migrationHistory(secondDatabase.connection)).toEqual(firstHistory);
    } finally {
      secondDatabase.close();
    }
    expect(secondDatabase.connection.open).toBe(false);

    const initializedServer = await initializeServer({ workspaceRoot });
    try {
      expect(initializedServer.database.connection.open).toBe(true);
      const response = await initializedServer.app.inject({
        method: "GET",
        url: "/api/health"
      });

      expect(response.statusCode).toBe(200);
      expect(apiSuccessResponseSchema.parse(response.json())).toEqual({
        data: { status: "ok" }
      });
    } finally {
      await initializedServer.app.close();
    }
    expect(initializedServer.database.connection.open).toBe(false);
  });
});
