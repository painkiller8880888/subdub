import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import { ProjectService } from "../../src/app/projects/project-service.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { idSchema, videoProjectSchema } from "../../src/schema/index.js";

describe("ProjectService", () => {
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

  it("creates a schema-valid project with backend-owned identity and timestamps", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-service-")
    );
    workspaceRoots.push(workspaceRoot);

    const service = new ProjectService({
      repository: new ProjectRepository(workspaceRoot),
      createId: () => "backend-generated-project",
      now: () => new Date("2026-08-04T01:02:03.000Z")
    });

    const project = await service.create({
      title: "  作成テスト  ",
      department: "総務部",
      manualVersion: "2026.08"
    });

    expect(videoProjectSchema.parse(project)).toEqual(project);
    expect(idSchema.parse(project.metadata.id)).toBe(
      "backend-generated-project"
    );
    expect(project.revision).toBe(0);
    expect(project.metadata.title).toBe("作成テスト");
    expect(project.metadata.createdAt).toBe("2026-08-04T01:02:03.000Z");
    expect(project.metadata.updatedAt).toBe("2026-08-04T01:02:03.000Z");
    expect(project.metadata.outputSettings).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioSampleRate: 48000,
      audioChannels: 2
    });
    expect(project.characters).toEqual([
      expect.objectContaining({
        id: "character-mentor",
        name: "四国めたん",
        role: "mentor",
        voicevox: {
          speakerName: "四国めたん",
          speakerUuid: null,
          styleName: "ノーマル"
        },
        themeColorToken: "character.metan",
        visualAssets: {
          stand: "shared-assets/characters/character-mentor/stand/stand.png",
          speak: {
            normal: {
              closed:
                "shared-assets/characters/character-mentor/speak-normal/closed.png",
              open: "shared-assets/characters/character-mentor/speak-normal/open.png"
            },
            pointing: {
              closed:
                "shared-assets/characters/character-mentor/speak-pointing/closed.png",
              open: "shared-assets/characters/character-mentor/speak-pointing/open.png"
            }
          }
        }
      }),
      expect.objectContaining({
        id: "character-learner",
        name: "ずんだもん",
        role: "learner",
        voicevox: {
          speakerName: "ずんだもん",
          speakerUuid: null,
          styleName: "ノーマル"
        },
        themeColorToken: "character.zundamon",
        visualAssets: {
          stand: "shared-assets/characters/character-learner/stand/stand.png",
          speak: {
            normal: {
              closed:
                "shared-assets/characters/character-learner/speak-normal/closed.png",
              open: "shared-assets/characters/character-learner/speak-normal/open.png"
            },
            pointing: {
              closed:
                "shared-assets/characters/character-learner/speak-pointing/closed.png",
              open: "shared-assets/characters/character-learner/speak-pointing/open.png"
            }
          }
        }
      })
    ]);
  });

  it("rejects unknown create input and keeps the API boundary strict", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-service-")
    );
    workspaceRoots.push(workspaceRoot);

    const service = new ProjectService({
      repository: new ProjectRepository(workspaceRoot)
    });

    await expect(
      service.create({ title: "入力テスト", unknown: "拒否" })
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(service.create({ title: "   " })).rejects.toMatchObject({
      name: "ZodError"
    });
  });

  it("applies fixed defaults when optional metadata is omitted", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-service-")
    );
    workspaceRoots.push(workspaceRoot);

    const service = new ProjectService({
      repository: new ProjectRepository(workspaceRoot),
      createId: () => "default-metadata-project",
      now: () => new Date("2026-08-04T01:02:03.000Z")
    });

    const project = await service.create({ title: "既定値テスト" });

    expect(project.metadata.department).toBe("General");
    expect(project.metadata.manualVersion).toBe("");
    expect(project.thumbnail.departmentOrSystem).toBe("General");
    expect(project.thumbnail.manualVersion).toBeNull();
    expect(
      project.characters.map((character) => character.lipSyncPeriodFrames)
    ).toEqual([4, 4]);
  });

  it("retries an ID collision without changing the existing project", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-project-service-")
    );
    workspaceRoots.push(workspaceRoot);

    const repository = new ProjectRepository(workspaceRoot);
    const existing = createEmptyVideoProject({
      projectId: "collision-project",
      title: "既存プロジェクト",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    await repository.create(existing);
    const existingFile = path.join(
      workspaceRoot,
      "projects",
      existing.metadata.id,
      "project.json"
    );
    const before = await fs.readFile(existingFile);
    const ids = ["collision-project", "retry-project"];

    const service = new ProjectService({
      repository,
      createId: () => {
        const nextId = ids.shift();
        if (nextId === undefined) {
          throw new Error("test ID sequence exhausted");
        }
        return nextId;
      },
      now: () => new Date("2026-08-04T01:02:03.000Z")
    });

    const created = await service.create({ title: "再試行プロジェクト" });

    expect(created.metadata.id).toBe("retry-project");
    expect(await fs.readFile(existingFile)).toEqual(before);
  });
});
