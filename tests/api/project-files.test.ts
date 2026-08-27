import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { ProjectFileService } from "../../src/app/projects/project-file-service.js";

const projectId = "file-project";
const roots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "subdub-project-files-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "projects", projectId, "media"), {
    recursive: true
  });
  return root;
}

describe("project file route", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("supports GET, HEAD, and a single byte range", async () => {
    const root = await createWorkspace();
    const filePath = path.join(
      root,
      "projects",
      projectId,
      "media",
      "clip.mp4"
    );
    await fs.writeFile(filePath, "0123456789", "utf8");
    await app.close();
    app = buildApp({
      projectFileService: new ProjectFileService({ workspaceRoot: root })
    });

    const full = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/clip.mp4`
    });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toMatch(/^video\/mp4/);
    expect(full.body).toBe("0123456789");

    const head = await app.inject({
      method: "HEAD",
      url: `/api/projects/${projectId}/files/media/clip.mp4`
    });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe("10");

    const range = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/clip.mp4`,
      headers: { range: "bytes=2-5" }
    });
    expect(range.statusCode).toBe(206);
    expect(range.body).toBe("2345");
    expect(range.headers["content-range"]).toBe("bytes 2-5/10");
  });

  it("serves managed preview output while keeping other output paths private", async () => {
    const root = await createWorkspace();
    const previewPath = path.join(
      root,
      "projects",
      projectId,
      "output",
      "previews",
      "run-hd-hd.mp4"
    );
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, "preview-bytes", "utf8");
    await fs.mkdir(path.join(root, "projects", projectId, "output"), {
      recursive: true
    });
    await fs.writeFile(
      path.join(root, "projects", projectId, "output", "render-run.mp4"),
      "production-bytes",
      "utf8"
    );
    await app.close();
    app = buildApp({
      projectFileService: new ProjectFileService({ workspaceRoot: root })
    });

    const preview = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/output/previews/run-hd-hd.mp4`
    });
    const production = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/output/render-run.mp4`
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toMatch(/^video\/mp4/);
    expect(preview.body).toBe("preview-bytes");
    expect(production.statusCode).toBe(400);
  });

  it("rejects traversal, encoded traversal, URL paths, and invalid ranges", async () => {
    const root = await createWorkspace();
    await fs.writeFile(path.join(root, "outside.txt"), "outside", "utf8");
    await fs.writeFile(
      path.join(root, "projects", projectId, "media", "clip.mp4"),
      "0123456789",
      "utf8"
    );
    await app.close();
    app = buildApp({
      projectFileService: new ProjectFileService({ workspaceRoot: root })
    });

    const directTraversal = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/../outside.txt`
    });
    const encodedTraversal = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/%2e%2e%2foutside.txt`
    });
    const urlPath = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/https://example.com/file`
    });
    const invalidRange = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/clip.mp4`,
      headers: { range: "bytes=100-101" }
    });

    expect(directTraversal.statusCode).not.toBe(200);
    expect(encodedTraversal.statusCode).toBe(400);
    expect(urlPath.statusCode).toBe(400);
    expect(invalidRange.statusCode).toBe(416);
    expect(encodedTraversal.body).not.toContain(root);
  });

  it("rejects a symlink that escapes the project root when the platform permits symlinks", async () => {
    const root = await createWorkspace();
    const outsideRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-outside-")
    );
    roots.push(outsideRoot);
    const outsideFile = path.join(outsideRoot, "outside.mp4");
    await fs.writeFile(outsideFile, "outside", "utf8");
    const linkPath = path.join(
      root,
      "projects",
      projectId,
      "media",
      "link.mp4"
    );
    try {
      await fs.symlink(outsideFile, linkPath, "file");
    } catch {
      return;
    }

    await app.close();
    app = buildApp({
      projectFileService: new ProjectFileService({ workspaceRoot: root })
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/files/media/link.mp4`
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(outsideRoot);
  });
});
