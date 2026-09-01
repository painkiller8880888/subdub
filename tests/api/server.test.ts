import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureWorkspaceDirectories,
  initializeServer
} from "../../src/api/server.js";

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

  it("starts and stops the render worker with the Fastify lifecycle", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-server-render-")
    );
    workspaceRoots.push(workspaceRoot);
    const renderJobService = {
      enqueueMp4: vi.fn(),
      enqueueThumbnail: vi.fn(),
      getStatus: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(async () => undefined)
    };

    const initialized = await initializeServer({
      workspaceRoot,
      renderJobService
    });
    expect(renderJobService.start).toHaveBeenCalledTimes(1);

    await initialized.app.close();
    expect(renderJobService.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps retired planning routes out of the standard Fastify app", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-server-routes-")
    );
    workspaceRoots.push(workspaceRoot);

    const initialized = await initializeServer({ workspaceRoot });
    try {
      const routes = initialized.app.printRoutes();
      for (const retiredRoute of [
        "/api/projects/:projectId/source",
        "/api/projects/:projectId/brief",
        "/api/projects/:projectId/outline",
        "/api/projects/:projectId/outline/generate",
        "/api/projects/:projectId/outline/approve",
        "/api/projects/:projectId/outline/reject",
        "/api/projects/:projectId/outline/review",
        "/api/projects/:projectId/script/initialize",
        "/api/projects/:projectId/script/approve"
      ]) {
        expect(routes).not.toContain(retiredRoute);
      }

      expect(routes).toMatch(/models \(GET, HEAD\)/u);
      expect(routes).toMatch(/script \(PUT\)/u);
      expect(routes).toMatch(/overlays \(PUT\)/u);
      expect(routes).toMatch(/edit \(GET, HEAD, PUT\)/u);
    } finally {
      await initialized.app.close();
    }
  });
});
