import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodeVisualAssignmentFileSystem } from "../../src/app/projects/visual-assignment-file-system.js";

describe("NodeVisualAssignmentFileSystem", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("does not replace an existing destination during exclusive placement", async () => {
    const root = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-visual-assignment-file-system-")
    );
    roots.push(root);
    const sourcePath = path.join(root, "source.tmp");
    const destinationPath = path.join(root, "visual.png");
    const sourceBytes = Buffer.from("source bytes", "utf8");
    const existingBytes = Buffer.from("existing bytes", "utf8");
    await fs.writeFile(sourcePath, sourceBytes);
    await fs.writeFile(destinationPath, existingBytes);

    const fileSystem = new NodeVisualAssignmentFileSystem();

    await expect(
      fileSystem.rename(sourcePath, destinationPath)
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(sourcePath)).toEqual(sourceBytes);
    expect(await fs.readFile(destinationPath)).toEqual(existingBytes);
  });
});
