import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureWorkspaceDirectories } from "../../src/api/server.js";

describe("workspace directories", () => {
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaceRoots.splice(0).map((workspaceRoot) =>
        fs.rm(workspaceRoot, { recursive: true, force: true })
      )
    );
  });

  it("creates library and projects when they are missing", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-server-")
    );
    workspaceRoots.push(workspaceRoot);

    await ensureWorkspaceDirectories(workspaceRoot);

    const libraryStats = await fs.stat(path.join(workspaceRoot, "library"));
    const projectsStats = await fs.stat(
      path.join(workspaceRoot, "projects")
    );

    expect(libraryStats.isDirectory()).toBe(true);
    expect(projectsStats.isDirectory()).toBe(true);
  });
});
