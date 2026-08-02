import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryFileSystem
} from "../../src/app/projects/project-repository.js";
import {
  videoProjectSchema,
  type VideoProject
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = videoProjectFixture.metadata.id;

function clone(value: typeof videoProjectFixture): VideoProject;
function clone<T>(value: T): T;
function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function asRepositoryError(error: unknown): ProjectRepositoryError {
  if (error instanceof ProjectRepositoryError) {
    return error;
  }

  throw error;
}

async function expectRepositoryError(
  operation: () => Promise<unknown>,
  code: ProjectRepositoryError["code"],
  status: number
): Promise<ProjectRepositoryError> {
  let thrown: unknown;
  let didThrow = false;

  try {
    await operation();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }

  if (!didThrow) {
    throw new Error(`Expected ${code} but operation succeeded.`);
  }

  const repositoryError = asRepositoryError(thrown);
  expect(repositoryError.code).toBe(code);
  expect(repositoryError.status).toBe(status);
  return repositoryError;
}

describe("ProjectRepository", () => {
  let workspaceRoot: string;
  let projectDirectory: string;
  let projectFile: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-repository-")
    );
    projectDirectory = path.join(workspaceRoot, "projects", projectId);
    projectFile = path.join(projectDirectory, "project.json");
    await fs.mkdir(projectDirectory, { recursive: true });
    await writeProject(clone(videoProjectFixture));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function writeProject(project: VideoProject): Promise<void> {
    await fs.writeFile(
      projectFile,
      `${JSON.stringify(project, null, 2)}\n`,
      "utf8"
    );
  }

  async function readProjectBytes(): Promise<Buffer> {
    return fs.readFile(projectFile);
  }

  async function listTemporaryFiles(): Promise<string[]> {
    const entries = await fs.readdir(projectDirectory);
    return entries.filter((entry) => entry.startsWith("project.json."));
  }

  function expectSafeExternalError(error: ProjectRepositoryError): void {
    expect(error.message).not.toContain(workspaceRoot);
    expect(error.stack).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(workspaceRoot);
  }

  it("saves through a same-directory temporary file and reloads the result", async () => {
    const writes: string[] = [];
    const renames: Array<{ source: string; destination: string }> = [];
    const fileSystem: Partial<ProjectRepositoryFileSystem> = {
      writeFile: async (filePath, contents) => {
        writes.push(filePath);
        await fs.writeFile(filePath, contents, {
          encoding: "utf8",
          flag: "wx"
        });
      },
      rename: async (source, destination) => {
        renames.push({ source, destination });
        await fs.rename(source, destination);
      }
    };
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem
    });
    const candidate = clone(videoProjectFixture);
    candidate.metadata.title = "保存後のタイトル";
    const beforeUpdatedAt = candidate.metadata.updatedAt;

    const saved = await repository.save(projectId, candidate, 0);
    const reloaded = await repository.read(projectId);
    const serialized = await fs.readFile(projectFile, "utf8");

    expect(saved.revision).toBe(1);
    expect(saved.metadata.title).toBe("保存後のタイトル");
    expect(saved.metadata.updatedAt).not.toBe(beforeUpdatedAt);
    expect(saved.metadata.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(videoProjectSchema.safeParse(saved).success).toBe(true);
    expect(videoProjectSchema.safeParse(reloaded).success).toBe(true);
    expect(reloaded).toEqual(saved);
    expect(serialized).toBe(`${JSON.stringify(saved, null, 2)}\n`);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(Buffer.from(serialized, "utf8")).toEqual(
      await readProjectBytes()
    );
    expect(writes).toHaveLength(1);
    expect(path.dirname(writes[0])).toBe(projectDirectory);
    expect(path.basename(writes[0])).toMatch(
      /^project\.json\.[0-9a-f-]+\.tmp$/
    );
    expect(renames).toEqual([
      { source: writes[0], destination: projectFile }
    ]);
    expect(await listTemporaryFiles()).toEqual([]);
  });

  it("rejects a revision conflict before creating a temporary file", async () => {
    let writeCount = 0;
    let renameCount = 0;
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        writeFile: async () => {
          writeCount += 1;
        },
        rename: async () => {
          renameCount += 1;
        }
      }
    });
    const before = await readProjectBytes();
    const candidate = clone(videoProjectFixture);
    candidate.metadata.title = "競合した更新";

    const error = await expectRepositoryError(
      () => repository.save(projectId, candidate, 1),
      "PROJECT_REVISION_CONFLICT",
      409
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(writeCount).toBe(0);
    expect(renameCount).toBe(0);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("rejects an invalid candidate without changing the current bytes", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    const before = await readProjectBytes();
    const invalidCandidate = clone(videoProjectFixture);
    Object.assign(invalidCandidate, { unknownKey: true });

    const error = await expectRepositoryError(
      () => repository.save(projectId, invalidCandidate, 0),
      "PROJECT_CANDIDATE_VALIDATION_FAILED",
      422
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("distinguishes a missing project and malformed JSON", async () => {
    const repository = new ProjectRepository(workspaceRoot);

    const missingError = await expectRepositoryError(
      () => repository.read("missing-project"),
      "PROJECT_NOT_FOUND",
      404
    );
    expectSafeExternalError(missingError);

    const malformed = Buffer.from("{\"schemaVersion\":", "utf8");
    await fs.writeFile(projectFile, malformed);
    const parseError = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_JSON_PARSE_FAILED",
      422
    );
    expect(await readProjectBytes()).toEqual(malformed);
    expectSafeExternalError(parseError);
  });

  it("rejects invalid current data and never repairs it", async () => {
    const invalidCurrent = Buffer.from('{"schemaVersion":"1.0.0"}', "utf8");
    await fs.writeFile(projectFile, invalidCurrent);
    const repository = new ProjectRepository(workspaceRoot);

    const readError = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_CURRENT_VALIDATION_FAILED",
      422
    );
    const saveError = await expectRepositoryError(
      () => repository.save(projectId, clone(videoProjectFixture), 0),
      "PROJECT_CURRENT_VALIDATION_FAILED",
      422
    );

    expect(await readProjectBytes()).toEqual(invalidCurrent);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(readError);
    expectSafeExternalError(saveError);
  });

  it("reports write failures without calling rename or changing the original", async () => {
    let renameCount = 0;
    const temporaryFiles: string[] = [];
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        writeFile: async (filePath, contents) => {
          temporaryFiles.push(filePath);
          await fs.writeFile(filePath, contents, {
            encoding: "utf8",
            flag: "wx"
          });
          throw new Error("injected write failure");
        },
        rename: async () => {
          renameCount += 1;
        }
      }
    });
    const before = await readProjectBytes();

    const error = await expectRepositoryError(
      () => repository.save(projectId, clone(videoProjectFixture), 0),
      "PROJECT_WRITE_FAILED",
      500
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(renameCount).toBe(0);
    expect(temporaryFiles).toHaveLength(1);
    await expect(fs.access(temporaryFiles[0])).rejects.toBeDefined();
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("reports rename failures and removes the temporary file", async () => {
    const temporaryFiles: string[] = [];
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        writeFile: async (filePath, contents) => {
          temporaryFiles.push(filePath);
          await fs.writeFile(filePath, contents, {
            encoding: "utf8",
            flag: "wx"
          });
        },
        rename: async () => {
          throw new Error("injected rename failure");
        }
      }
    });
    const before = await readProjectBytes();

    const error = await expectRepositoryError(
      () => repository.save(projectId, clone(videoProjectFixture), 0),
      "PROJECT_RENAME_FAILED",
      500
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(temporaryFiles).toHaveLength(1);
    await expect(fs.access(temporaryFiles[0])).rejects.toBeDefined();
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("rejects unsafe IDs before touching the filesystem", async () => {
    const realpathCalls: string[] = [];
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        realpath: async (filePath) => {
          realpathCalls.push(filePath);
          throw new Error("filesystem should not be reached");
        }
      }
    });
    const unsafeIds = [
      "../outside",
      "/absolute/project",
      "C:\\outside\\project",
      "\\\\server\\share\\project",
      "nested/project",
      "nested\\project"
    ];
    unsafeIds.push(path.resolve(workspaceRoot, "outside"));

    for (const unsafeId of unsafeIds) {
      const error = await expectRepositoryError(
        () => repository.read(unsafeId),
        "PROJECT_ID_INVALID",
        400
      );
      expectSafeExternalError(error);
    }

    expect(realpathCalls).toEqual([]);
  });

  it("rejects a project directory symlink that resolves outside the workspace", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const outsideDirectory = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-outside-")
    );
    const outsideProjectFile = path.join(outsideDirectory, "project.json");

    try {
      await fs.writeFile(
        outsideProjectFile,
        `${JSON.stringify(clone(videoProjectFixture), null, 2)}\n`,
        "utf8"
      );

      try {
        await fs.symlink(
          outsideDirectory,
          projectDirectory,
          process.platform === "win32" ? "junction" : "dir"
        );
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
        if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") {
          return;
        }
        throw error;
      }

      const outsideBefore = await fs.readFile(outsideProjectFile);
      const repository = new ProjectRepository(workspaceRoot);
      const error = await expectRepositoryError(
        () => repository.read(projectId),
        "PROJECT_PATH_INVALID",
        400
      );

      expect(await fs.readFile(outsideProjectFile)).toEqual(outsideBefore);
      expectSafeExternalError(error);
    } finally {
      await fs.rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});
