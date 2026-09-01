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
import { createEmptyVideoProject } from "../fixtures/empty-video-project.js";
import {
  legacyVideoProjectFixture,
  videoProjectFixture
} from "../fixtures/video-project.js";

const projectId = videoProjectFixture.metadata.id;

function clone(value: typeof videoProjectFixture): VideoProject;
function clone<T>(value: T): T;
function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function legacyVideoProjectV11(): Record<string, unknown> {
  const legacy = clone(legacyVideoProjectFixture) as Record<string, unknown>;
  delete legacy.overlays;
  const edit = legacy.edit as {
    sectionBgms: Array<{
      id: string;
      sectionId: string;
      projectMediaPath: string;
      volume: number;
    }>;
  };
  const audio = legacy.audio as { soundEffects: unknown[] };
  legacy.schemaVersion = "1.1.0";
  legacy.audio = {
    sectionBgms: edit.sectionBgms.map((bgm) => ({
      id: bgm.id,
      sectionId: bgm.sectionId,
      path: bgm.projectMediaPath,
      volume: bgm.volume,
      loop: true,
      fadeInMs: 0,
      fadeOutMs: 0
    })),
    soundEffects: audio.soundEffects
  };
  legacy.inserts = {
    opening: {
      id: "insert-opening",
      kind: "placeholder",
      slot: "opening",
      durationMs: 2000
    },
    ending: {
      id: "insert-ending",
      kind: "placeholder",
      slot: "ending",
      durationMs: 2000
    },
    eyeCatches: []
  };
  delete legacy.edit;

  const visuals = legacy.visuals as {
    assignments: Array<{ display: Record<string, unknown> }>;
  };
  for (const assignment of visuals.assignments) {
    delete assignment.display.displayCoordinateSpace;
    if (assignment.display.kind !== "video") {
      continue;
    }
    delete assignment.display.playbackCues;
    assignment.display.muted = assignment.display.volume === 0;
    delete assignment.display.volume;
  }
  const script = legacy.script as {
    sections: Array<{
      screenTemplateId?: unknown;
      lines: Array<{ screenTemplateId?: unknown }>;
    }>;
  };
  for (const section of script.sections) {
    delete section.screenTemplateId;
    for (const line of section.lines) {
      delete line.screenTemplateId;
    }
  }
  return legacy;
}

function lineScreenTemplateOverrideProject(): Record<string, unknown> {
  const project = clone(legacyVideoProjectFixture) as unknown as Record<
    string,
    unknown
  >;
  delete project.overlays;
  project.schemaVersion = "1.3.0";
  const script = project.script as {
    sections: Array<{ lines: Array<Record<string, unknown>> }>;
  };
  for (const section of script.sections) {
    for (const line of section.lines) {
      line.screenTemplateId = null;
    }
  }
  const visuals = project.visuals as {
    assignments: Array<{ display: Record<string, unknown> }>;
  };
  for (const assignment of visuals.assignments) {
    delete assignment.display.playbackCues;
  }
  const overrideLine = script.sections[1]?.lines[0];
  if (overrideLine === undefined) {
    throw new Error("line override fixture is missing a line");
  }
  overrideLine.screenTemplateId = "screen-template-alternate";
  return project;
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

  async function writeRawProject(project: unknown): Promise<void> {
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

  function createProjectCandidate(): VideoProject {
    return createEmptyVideoProject({
      projectId,
      createdAt: "2026-08-03T00:00:00.000Z"
    });
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
    candidate.metadata.createdAt = "2026-08-03T12:00:00.000Z";
    const beforeUpdatedAt = candidate.metadata.updatedAt;

    const saved = await repository.save(projectId, candidate, 0);
    const reloaded = await repository.read(projectId);
    const serialized = await fs.readFile(projectFile, "utf8");

    expect(saved.revision).toBe(1);
    expect(saved.metadata.title).toBe("保存後のタイトル");
    expect(saved.metadata.createdAt).toBe(
      videoProjectFixture.metadata.createdAt
    );
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

  it("serializes concurrent saves so only one update succeeds", async () => {
    const firstRepository = new ProjectRepository(workspaceRoot);
    const secondRepository = new ProjectRepository(workspaceRoot);
    const firstCandidate = clone(videoProjectFixture);
    firstCandidate.metadata.title = "並行保存A";
    const secondCandidate = clone(videoProjectFixture);
    secondCandidate.metadata.title = "並行保存B";

    const results = await Promise.allSettled([
      firstRepository.save(projectId, firstCandidate, 0),
      secondRepository.save(projectId, secondCandidate, 0)
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<VideoProject> =>
        result.status === "fulfilled"
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ProjectRepositoryError);
    if (!(rejected[0].reason instanceof ProjectRepositoryError)) {
      throw rejected[0].reason;
    }
    expect(rejected[0].reason.code).toBe("PROJECT_REVISION_CONFLICT");
    expect(rejected[0].reason.status).toBe(409);

    const finalProject = await firstRepository.read(projectId);
    expect(finalProject.revision).toBe(1);
    expect(["並行保存A", "並行保存B"]).toContain(finalProject.metadata.title);
  });

  it("holds the project lock across legacy migration replacement", async () => {
    const legacy = legacyVideoProjectV11();
    legacy.revision = 7;
    await writeRawProject(legacy);

    let resolveMigrationRenameStarted: () => void = () => undefined;
    const migrationRenameStarted = new Promise<void>((resolve) => {
      resolveMigrationRenameStarted = resolve;
    });
    let releaseMigrationRename: () => void = () => undefined;
    const migrationRenameRelease = new Promise<void>((resolve) => {
      releaseMigrationRename = resolve;
    });
    let migrationRenamePaused = false;
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        rename: async (source, destination) => {
          if (
            !migrationRenamePaused &&
            destination === projectFile &&
            path.basename(source).startsWith("project.json.")
          ) {
            migrationRenamePaused = true;
            resolveMigrationRenameStarted();
            await migrationRenameRelease;
          }
          await fs.rename(source, destination);
        }
      }
    });

    const readPromise = repository.read(projectId);
    await migrationRenameStarted;

    const candidate = clone(videoProjectFixture);
    candidate.metadata.title = "migration と同時の保存";
    let saveCompleted = false;
    const savePromise = repository
      .save(projectId, candidate, 13)
      .then((saved) => {
        saveCompleted = true;
        return saved;
      });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(saveCompleted).toBe(false);

    releaseMigrationRename();
    const [migrated, saved] = await Promise.all([readPromise, savePromise]);
    expect(migrated.revision).toBe(13);
    expect(saved.revision).toBe(14);
    expect(saved.metadata.title).toBe("migration と同時の保存");

    const finalProject = JSON.parse(
      await fs.readFile(projectFile, "utf8")
    ) as VideoProject;
    expect(finalProject.revision).toBe(14);
    expect(finalProject.metadata.title).toBe("migration と同時の保存");
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

  it("rejects a current JSON ID that does not match the directory ID", async () => {
    const invalidCurrent = clone(videoProjectFixture);
    invalidCurrent.metadata.id = "other-project";
    await writeProject(invalidCurrent);
    const before = await readProjectBytes();
    const repository = new ProjectRepository(workspaceRoot);

    const readError = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_CURRENT_ID_MISMATCH",
      422
    );

    expectSafeExternalError(readError);

    const error = await expectRepositoryError(
      () => repository.save(projectId, clone(videoProjectFixture), 0),
      "PROJECT_CURRENT_ID_MISMATCH",
      422
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("rejects a candidate JSON ID that does not match the directory ID", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    const candidate = clone(videoProjectFixture);
    candidate.metadata.id = "other-project";
    const before = await readProjectBytes();

    const error = await expectRepositoryError(
      () => repository.save(projectId, candidate, 0),
      "PROJECT_CANDIDATE_ID_MISMATCH",
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

  it("keeps a legacy project untouched when the standard template is unavailable", async () => {
    await writeRawProject(legacyVideoProjectV11());
    const before = await readProjectBytes();
    const repository = new ProjectRepository({
      workspaceRoot,
      screenTemplateCatalog: { findById: () => undefined }
    });

    const error = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_MIGRATION_PREREQUISITE_FAILED",
      503
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("persists migration diagnostics before replacing a legacy project", async () => {
    const legacy = legacyVideoProjectV11();
    legacy.revision = 7;
    await writeRawProject(legacy);
    const before = await readProjectBytes();
    const repository = new ProjectRepository(workspaceRoot);

    const migrated = await repository.read(projectId);
    expect(migrated.schemaVersion).toBe("1.9.0");
    expect(migrated.revision).toBe(13);
    expect(migrated.edit).toEqual({ videoElements: [], sectionBgms: [] });
    expect(migrated.audio).not.toHaveProperty("sectionBgms");

    const migrationLogPath = path.join(
      projectDirectory,
      "logs",
      "migration-log.jsonl"
    );
    const migrationLog = await fs.readFile(migrationLogPath, "utf8");
    const entries = migrationLog
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      fromSchemaVersion: "1.1.0",
      toSchemaVersion: "1.2.0",
      kind: "unresolved_legacy_bgm",
      sectionId: "section-intro",
      legacyPath: "media/bgm-intro.mp3",
      legacyVolume: 0.25
    });
    expect(entries[2]).toMatchObject({
      fromSchemaVersion: "1.2.0",
      toSchemaVersion: "1.3.0",
      kind: "screen_template_selection",
      templateId: "screen-template-standard"
    });
    expect(entries[3]).toMatchObject({
      fromSchemaVersion: "1.8.0",
      toSchemaVersion: "1.9.0",
      kind: "video_project_v19_shape",
      removedRootFields: ["source", "brief", "outline"],
      existingOutlineSectionCount: 3,
      existingScriptSectionCount: 3,
      starterSectionsCreated: false
    });

    const migratedBytes = await readProjectBytes();
    expect(migratedBytes).not.toEqual(before);
    expect(JSON.parse(migratedBytes.toString("utf8")).schemaVersion).toBe(
      "1.9.0"
    );

    await repository.read(projectId);
    expect(await fs.readFile(migrationLogPath, "utf8")).toBe(migrationLog);
  });

  it("migrates 1.3.0 line overrides and writes one diagnostic per non-null override", async () => {
    const project = lineScreenTemplateOverrideProject();
    await writeRawProject(project);
    const repository = new ProjectRepository(workspaceRoot);

    const migrated = await repository.read(projectId);
    expect(migrated.schemaVersion).toBe("1.9.0");
    expect(migrated.revision).toBe((project.revision as number) + 6);
    for (const line of migrated.script.sections.flatMap((section) => section.lines)) {
      expect(line).not.toHaveProperty("screenTemplateId");
    }

    const migrationLogPath = path.join(
      projectDirectory,
      "logs",
      "migration-log.jsonl"
    );
    const migrationLog = await fs.readFile(migrationLogPath, "utf8");
    const entries = migrationLog
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      fromSchemaVersion: "1.3.0",
      toSchemaVersion: "1.4.0",
      kind: "removed_line_screen_template_override",
      sectionId: "section-main",
      lineId: "main-mentor-1",
      oldLineScreenTemplateId: "screen-template-alternate",
      effectiveSectionScreenTemplateId: "screen-template-standard"
    });

    await repository.read(projectId);
    expect(await fs.readFile(migrationLogPath, "utf8")).toBe(migrationLog);
  });

  it("keeps a 1.3.0 project untouched when migration diagnostics cannot be written", async () => {
    await writeRawProject(lineScreenTemplateOverrideProject());
    const before = await readProjectBytes();
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        writeFile: async (filePath, contents) => {
          if (path.basename(filePath).startsWith("migration-log.jsonl.")) {
            throw new Error("injected migration log write failure");
          }
          await fs.writeFile(filePath, contents, {
            encoding: "utf8",
            flag: "wx"
          });
        }
      }
    });

    const error = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_MIGRATION_LOG_WRITE_FAILED",
      500
    );

    expect(await readProjectBytes()).toEqual(before);
    await expect(
      fs.access(path.join(projectDirectory, "logs", "migration-log.jsonl"))
    ).rejects.toBeDefined();
    expectSafeExternalError(error);
  });

  it("keeps the legacy project untouched when migration diagnostics cannot be written", async () => {
    await writeRawProject(legacyVideoProjectV11());
    const before = await readProjectBytes();
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        writeFile: async (filePath, contents) => {
          if (path.basename(filePath).startsWith("migration-log.jsonl.")) {
            throw new Error("injected migration log write failure");
          }
          await fs.writeFile(filePath, contents, {
            encoding: "utf8",
            flag: "wx"
          });
        }
      }
    });

    const error = await expectRepositoryError(
      () => repository.read(projectId),
      "PROJECT_MIGRATION_LOG_WRITE_FAILED",
      500
    );

    expect(await readProjectBytes()).toEqual(before);
    expect(await listTemporaryFiles()).toEqual([]);
    expectSafeExternalError(error);
  });

  it("rejects legacy candidates in save without implicitly migrating them", async () => {
    const repository = new ProjectRepository(workspaceRoot);
    const legacy = legacyVideoProjectV11();
    const before = await readProjectBytes();

    const error = await expectRepositoryError(
      () => repository.save(projectId, legacy, 0),
      "PROJECT_CANDIDATE_VALIDATION_FAILED",
      422
    );

    expect(await readProjectBytes()).toEqual(before);
    await expect(
      fs.access(path.join(projectDirectory, "logs", "migration-log.jsonl"))
    ).rejects.toBeDefined();
    expectSafeExternalError(error);
  });

  it("rejects legacy candidates in create instead of implicitly migrating them", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const repository = new ProjectRepository(workspaceRoot);
    const legacy = legacyVideoProjectV11();
    legacy.revision = 0;

    const error = await expectRepositoryError(
      () => repository.create(legacy),
      "PROJECT_CANDIDATE_VALIDATION_FAILED",
      422
    );

    expect(await fs.readdir(path.join(workspaceRoot, "projects"))).toEqual([]);
    expectSafeExternalError(error);
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

  it("removes a create temp directory after a write failure so the ID can be retried", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const candidate = createProjectCandidate();
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
          throw new Error("injected create write failure");
        }
      }
    });

    const error = await expectRepositoryError(
      () => repository.create(candidate),
      "PROJECT_WRITE_FAILED",
      500
    );

    expectSafeExternalError(error);
    expect(temporaryFiles).toHaveLength(1);
    await expect(fs.access(temporaryFiles[0])).rejects.toBeDefined();
    await expect(fs.stat(projectDirectory)).rejects.toBeDefined();
    expect(await fs.readdir(path.join(workspaceRoot, "projects"))).toEqual([]);

    await expect(new ProjectRepository(workspaceRoot).create(candidate)).resolves.toEqual(
      candidate
    );
  });

  it("removes a create temp directory after a rename failure so the ID can be retried", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const candidate = createProjectCandidate();
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
          throw new Error("injected create rename failure");
        }
      }
    });

    const error = await expectRepositoryError(
      () => repository.create(candidate),
      "PROJECT_RENAME_FAILED",
      500
    );

    expectSafeExternalError(error);
    expect(temporaryFiles).toHaveLength(2);
    await Promise.all(
      temporaryFiles.map((temporaryFile) =>
        expect(fs.access(temporaryFile)).rejects.toBeDefined()
      )
    );
    await expect(fs.stat(projectDirectory)).rejects.toBeDefined();
    expect(await fs.readdir(path.join(workspaceRoot, "projects"))).toEqual([]);

    await expect(new ProjectRepository(workspaceRoot).create(candidate)).resolves.toEqual(
      candidate
    );
  });

  it("reports temporary directory creation failures and allows the ID to be retried", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const candidate = createProjectCandidate();
    let temporaryDirectoryMkdirAttempts = 0;
    let writeFileAttempts = 0;
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        mkdir: async (directoryPath, options) => {
          if (path.basename(directoryPath).startsWith(".subdub-project-")) {
            temporaryDirectoryMkdirAttempts += 1;
            throw new Error("injected temporary directory mkdir failure");
          }
          await fs.mkdir(directoryPath, options);
        },
        writeFile: async (filePath, contents) => {
          writeFileAttempts += 1;
          await fs.writeFile(filePath, contents, {
            encoding: "utf8",
            flag: "wx"
          });
        }
      }
    });

    const error = await expectRepositoryError(
      () => repository.create(candidate),
      "PROJECT_WRITE_FAILED",
      500
    );

    expectSafeExternalError(error);
    expect(temporaryDirectoryMkdirAttempts).toBe(1);
    expect(writeFileAttempts).toBe(0);
    await expect(fs.stat(projectDirectory)).rejects.toBeDefined();
    expect(await fs.readdir(path.join(workspaceRoot, "projects"))).toEqual([]);

    await expect(new ProjectRepository(workspaceRoot).create(candidate)).resolves.toEqual(
      candidate
    );
  });

  it("reports a duplicate create as a conflict without changing the existing bytes", async () => {
    await fs.rm(projectDirectory, { recursive: true, force: true });
    const candidate = createProjectCandidate();
    const repository = new ProjectRepository(workspaceRoot);
    await repository.create(candidate);
    const before = await fs.readFile(path.join(projectDirectory, "project.json"));

    const error = await expectRepositoryError(
      () => repository.create(candidate),
      "PROJECT_ALREADY_EXISTS",
      409
    );

    expect(await fs.readFile(path.join(projectDirectory, "project.json"))).toEqual(
      before
    );
    expectSafeExternalError(error);
  });

  it("returns the validated result without reading again after rename", async () => {
    let readFileCount = 0;
    const repository = new ProjectRepository({
      workspaceRoot,
      fileSystem: {
        readFile: async (filePath) => {
          readFileCount += 1;
          if (readFileCount > 1) {
            throw new Error("post-rename reads are not allowed");
          }
          return fs.readFile(filePath, { encoding: "utf8" });
        }
      }
    });
    const candidate = clone(videoProjectFixture);
    candidate.metadata.title = "再読込なしの保存";

    const saved = await repository.save(projectId, candidate, 0);
    const rawSaved = await fs.readFile(projectFile, "utf8");

    expect(readFileCount).toBe(1);
    expect(saved.revision).toBe(1);
    expect(saved.metadata.title).toBe("再読込なしの保存");
    expect(JSON.parse(rawSaved)).toEqual(saved);
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

  it("rejects a migration logs symlink that resolves outside the workspace", async () => {
    const outsideDirectory = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-migration-logs-outside-")
    );
    const logsDirectoryPath = path.join(projectDirectory, "logs");
    const outsideMigrationLogPath = path.join(
      outsideDirectory,
      "migration-log.jsonl"
    );

    try {
      try {
        await fs.symlink(
          outsideDirectory,
          logsDirectoryPath,
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

      const legacy = legacyVideoProjectV11();
      await writeRawProject(legacy);
      const before = await readProjectBytes();
      const repository = new ProjectRepository(workspaceRoot);
      const error = await expectRepositoryError(
        () => repository.read(projectId),
        "PROJECT_PATH_INVALID",
        400
      );

      expect(await readProjectBytes()).toEqual(before);
      await expect(fs.access(outsideMigrationLogPath)).rejects.toBeDefined();
      expectSafeExternalError(error);
    } finally {
      await fs.rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});
