import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryFileSystem
} from "../../src/app/projects/project-repository.js";
import type { VideoProject } from "../../src/schema/index.js";

const projectId = "source-project";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectRepositoryError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ProjectRepositoryError);
  expect((error as ProjectRepositoryError).code).toBe(code);
}

describe("ProjectRepository source and brief saves", () => {
  let workspaceRoot: string;
  let projectDirectory: string;
  let projectFile: string;
  let sourceFile: string;
  let initialProject: VideoProject;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-source-")
    );
    projectDirectory = path.join(workspaceRoot, "projects", projectId);
    projectFile = path.join(projectDirectory, "project.json");
    sourceFile = path.join(projectDirectory, "source", "source.md");
    initialProject = createEmptyVideoProject({
      projectId,
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    await new ProjectRepository(workspaceRoot).create(initialProject);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function readPair(): Promise<{ project: Buffer; source: Buffer }> {
    return {
      project: await fs.readFile(projectFile),
      source: await fs.readFile(sourceFile)
    };
  }

  function repositoryWithFailures(options: {
    failWriteAt?: number;
    failRenameAt?: number;
  }): ProjectRepository {
    let writeCount = 0;
    let renameCount = 0;
    const fileSystem: Partial<ProjectRepositoryFileSystem> = {
      writeFile: async (filePath, contents) => {
        writeCount += 1;
        if (writeCount === options.failWriteAt) {
          throw new Error("injected write failure");
        }
        await fs.writeFile(filePath, contents, {
          encoding: "utf8",
          flag: "wx"
        });
      },
      rename: async (sourcePath, destinationPath) => {
        renameCount += 1;
        if (renameCount === options.failRenameAt) {
          throw new Error("injected rename failure");
        }
        await fs.rename(sourcePath, destinationPath);
      }
    };
    return new ProjectRepository({ workspaceRoot, fileSystem });
  }

  it("reads empty and Japanese Markdown while returning the verified hash", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    await expect(repository.readSource(projectId)).resolves.toEqual({
      markdown: "",
      sha256: createHash("sha256").update("", "utf8").digest("hex"),
      revision: 0
    });

    const markdown = "# \u65e5\u672c\u8a9e\n\n\u8cc7\u6599\u306e\u672c\u6587";
    const saved = await repository.saveSource(projectId, markdown, 0);
    expect(saved.source.sha256).toBe(
      createHash("sha256").update(markdown, "utf8").digest("hex")
    );
    await expect(repository.readSource(projectId)).resolves.toEqual({
      markdown,
      sha256: saved.source.sha256,
      revision: 1
    });
  });

  it("commits source content and JSON together with the actual UTF-8 hash", async () => {
    const markdown = "\u65e5\u672c\u8a9e: \u03a9\n\ud83c\udf1f";
    const repository = new ProjectRepository(workspaceRoot);
    const before = await readPair();
    const saved = await repository.saveSource(projectId, markdown, 0);
    const savedProject = JSON.parse(
      await fs.readFile(projectFile, "utf8")
    ) as VideoProject;

    expect(saved.revision).toBe(1);
    expect(saved.metadata.updatedAt).not.toBe(
      initialProject.metadata.updatedAt
    );
    expect(await fs.readFile(sourceFile, "utf8")).toBe(markdown);
    expect(savedProject.source.sha256).toBe(
      createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex")
    );
    expect(savedProject.source.sha256).toBe(saved.source.sha256);
    expect((await readPair()).project).not.toEqual(before.project);
  });

  it("replaces only brief fields and preserves source and other project fields", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    const markdown = "brief preservation source";
    await repository.saveSource(projectId, markdown, 0);
    const before = await repository.read(projectId);
    const brief = {
      audience: "new audience",
      postViewingGoal: "new goal",
      prerequisites: ["one", "two"],
      targetDurationSec: 90,
      requiredItems: ["required"],
      prohibitedItems: ["prohibited"],
      globalDirectives: ["directive"]
    };

    const saved = await repository.saveBrief(projectId, brief, 1);
    const reloaded = await repository.read(projectId);

    expect(saved.brief).toEqual(brief);
    expect(reloaded.brief).toEqual(brief);
    expect(reloaded.source).toEqual(before.source);
    expect(reloaded.metadata.id).toBe(before.metadata.id);
    expect(reloaded.metadata.createdAt).toBe(before.metadata.createdAt);
    expect(reloaded.characters).toEqual(before.characters);
    expect(reloaded.revision).toBe(2);
    expect(await fs.readFile(sourceFile, "utf8")).toBe(markdown);
  });

  it("rejects source and project temporary write failures without changing the pair", async () => {
    for (const failWriteAt of [1, 2]) {
      const before = await readPair();
      try {
        await repositoryWithFailures({ failWriteAt }).saveSource(
          projectId,
          "new source",
          0
        );
        throw new Error("expected saveSource to fail");
      } catch (error) {
        expectRepositoryError(error, "PROJECT_WRITE_FAILED");
      }
      expect(await readPair()).toEqual(before);
    }
  });

  it("rolls back both files when the second commit rename fails", async () => {
    const before = await readPair();
    try {
      await repositoryWithFailures({ failRenameAt: 4 }).saveSource(
        projectId,
        "commit failure source",
        0
      );
      throw new Error("expected saveSource to fail");
    } catch (error) {
      expectRepositoryError(error, "PROJECT_RENAME_FAILED");
    }

    const after = await readPair();
    expect(after).toEqual(before);
    const project = JSON.parse(after.project.toString("utf8")) as VideoProject;
    expect(project.source.sha256).toBe(
      createHash("sha256").update(after.source).digest("hex")
    );
  });

  it("serializes source and brief saves through the same revision lock", async () => {
    const sourceRepository = new ProjectRepository(workspaceRoot);
    const briefRepository = new ProjectRepository(workspaceRoot);
    const result = await Promise.allSettled([
      sourceRepository.saveSource(projectId, "parallel source", 0),
      briefRepository.saveBrief(
        projectId,
        { ...initialProject.brief, audience: "parallel audience" },
        0
      )
    ]);

    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1
    );
    const rejected = result.find((item) => item.status === "rejected");
    expect(rejected?.reason).toMatchObject({
      code: "PROJECT_REVISION_CONFLICT",
      status: 409
    });
    const finalProject = JSON.parse(
      await fs.readFile(projectFile, "utf8")
    ) as VideoProject;
    const finalSource = await fs.readFile(sourceFile);
    expect(finalProject.revision).toBe(1);
    expect(finalProject.source.sha256).toBe(
      createHash("sha256").update(finalSource).digest("hex")
    );
  });

  it("rejects stale source and brief revisions without modifying either file", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    await repository.saveSource(projectId, "first", 0);
    const before = await readPair();

    await expect(
      repository.saveSource(projectId, "stale source", 0)
    ).rejects.toMatchObject({
      code: "PROJECT_REVISION_CONFLICT",
      status: 409
    });
    await expect(
      repository.saveBrief(projectId, initialProject.brief, 0)
    ).rejects.toMatchObject({
      code: "PROJECT_REVISION_CONFLICT",
      status: 409
    });
    expect(await readPair()).toEqual(before);
  });

  it("does not repair a source whose actual bytes no longer match the stored hash", async () => {
    await fs.writeFile(sourceFile, "tampered markdown", "utf8");
    const repository = new ProjectRepository(workspaceRoot);

    await expect(repository.readSource(projectId)).rejects.toMatchObject({
      code: "PROJECT_SOURCE_HASH_MISMATCH",
      status: 422
    });
    await expect(
      repository.saveSource(projectId, "replacement", 0)
    ).rejects.toMatchObject({
      code: "PROJECT_SOURCE_HASH_MISMATCH",
      status: 422
    });
    expect(await fs.readFile(sourceFile, "utf8")).toBe("tampered markdown");
    expect(await fs.readFile(projectFile, "utf8")).toBe(
      `${JSON.stringify(initialProject, null, 2)}\n`
    );
  });

  it("normalizes missing and unreadable source failures", async () => {
    await fs.rm(sourceFile);
    await expect(
      new ProjectRepository(workspaceRoot).readSource(projectId)
    ).rejects.toMatchObject({
      code: "PROJECT_SOURCE_NOT_FOUND",
      status: 422
    });

    await fs.writeFile(sourceFile, "", "utf8");
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        readFile: async (filePath) => {
          if (filePath === sourceFile) {
            throw new Error("private absolute path and Markdown");
          }
          return fs.readFile(filePath, "utf8");
        }
      }
    });
    await expect(repository.readSource(projectId)).rejects.toMatchObject({
      code: "PROJECT_SOURCE_READ_FAILED",
      status: 500
    });
  });

  it("rejects invalid brief input and invalid revisions before changing files", async () => {
    const before = await readPair();
    const repository = new ProjectRepository(workspaceRoot);
    const invalidBrief = clone(initialProject.brief);
    invalidBrief.targetDurationSec = 0;

    await expect(
      repository.saveBrief(projectId, invalidBrief, 0)
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED"
    });
    await expect(
      repository.saveBrief(
        projectId,
        { ...initialProject.brief, unknown: true },
        0
      )
    ).rejects.toMatchObject({
      code: "PROJECT_CANDIDATE_VALIDATION_FAILED"
    });
    await expect(
      repository.saveBrief(projectId, initialProject.brief, "0")
    ).rejects.toMatchObject({
      code: "PROJECT_EXPECTED_REVISION_INVALID"
    });
    expect(await readPair()).toEqual(before);
  });
});
