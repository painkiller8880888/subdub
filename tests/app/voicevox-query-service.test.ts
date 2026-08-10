import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSpokenText } from "../../src/app/terminology/spoken-text-resolver.js";
import { VoicevoxQueryCache } from "../../src/app/voicevox/query-cache.js";
import { VoicevoxQueryService } from "../../src/app/voicevox/query-service.js";
import type { TerminologyTerm } from "../../src/schema/terminology.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import { createVoicevoxAudioQueryFixture } from "../fixtures/voicevox.js";

const term: TerminologyTerm = {
  termId: "term-application",
  surface: "申請",
  normalizedSurface: "申請",
  readingKatakana: "シンセイ",
  category: "system",
  priority: 1,
  notes: "",
  status: "active",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z"
};

const resolvedSpeaker = {
  speakerName: "四国めたん",
  speakerUuid: "metan-fixture-uuid",
  styleName: "ノーマル",
  resolvedStyleId: 10_001
};

const workspaceRoots: string[] = [];

function makeTerminologyService() {
  return {
    preview: vi.fn((input: unknown) => {
      const request = input as {
        spokenText: string;
        pronunciation: {
          mode: "dictionary" | "literal";
          excludedTermIds: readonly string[];
        };
      };
      return resolveSpokenText({
        spokenText: request.spokenText,
        pronunciation: request.pronunciation,
        terms: [term]
      });
    })
  };
}

async function makeService(options: { version?: string } = {}) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-voicevox-query-")
  );
  workspaceRoots.push(workspaceRoot);
  await fs.mkdir(
    path.join(workspaceRoot, "projects", videoProjectFixture.metadata.id),
    { recursive: true }
  );

  const terminologyService = makeTerminologyService();
  const client = {
    getVersion: vi.fn(async () => options.version ?? "engine-fixture-1"),
    getAudioQuery: vi.fn(async (text: string, styleId: number) => ({
      ...createVoicevoxAudioQueryFixture(),
      generated_for: text,
      generated_style_id: styleId
    }))
  };

  return {
    workspaceRoot,
    terminologyService,
    client,
    service: new VoicevoxQueryService({
      client,
      terminologyService,
      workspaceRoot
    })
  };
}

function line() {
  return videoProjectFixture.script.sections[1]?.lines[0];
}

function character() {
  return videoProjectFixture.characters[0];
}

function input(overrides: Record<string, unknown> = {}) {
  const value = line();
  const currentCharacter = character();
  if (value === undefined || currentCharacter === undefined) {
    throw new Error("fixture line and character are required");
  }

  return {
    projectId: videoProjectFixture.metadata.id,
    line: value,
    character: currentCharacter,
    resolvedSpeaker,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(
    workspaceRoots
      .splice(0)
      .map((workspaceRoot) =>
        fs.rm(workspaceRoot, { recursive: true, force: true })
      )
  );
});

describe("VoicevoxQueryService", () => {
  it("resolves terminology, applies effective voice, and reuses the query cache", async () => {
    const { workspaceRoot, client, terminologyService, service } =
      await makeService();
    const originalLine = line();
    const originalCharacter = character();
    if (originalLine === undefined || originalCharacter === undefined) {
      throw new Error("fixture line and character are required");
    }
    const lineSnapshot = structuredClone(originalLine);
    const characterSnapshot = structuredClone(originalCharacter);
    const first = await service.prepare(
      input({
        line: {
          ...originalLine,
          voiceOverrides: { speedScale: 1.2, volumeScale: 0.8 }
        }
      })
    );

    expect(first.cached).toBe(false);
    expect(first.resolvedSpokenText).toContain("シンセイ");
    expect(first.appliedTerms).toEqual([
      {
        termId: term.termId,
        surface: term.surface,
        reading: term.readingKatakana,
        termUpdatedAt: term.updatedAt
      },
      {
        termId: term.termId,
        surface: term.surface,
        reading: term.readingKatakana,
        termUpdatedAt: term.updatedAt
      }
    ]);
    expect(first.voicevoxEngineVersion).toBe("engine-fixture-1");
    expect(first.resolvedSpeaker).toEqual(resolvedSpeaker);
    expect(first.queryPath).toBe(
      `projects/${videoProjectFixture.metadata.id}/cache/voicevox-query/${originalLine.id}-${first.cacheKey}.json`
    );
    expect(client.getVersion).toHaveBeenCalledTimes(1);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(1);
    expect(client.getAudioQuery).toHaveBeenCalledWith(
      first.resolvedSpokenText,
      resolvedSpeaker.resolvedStyleId
    );
    expect(terminologyService.preview).toHaveBeenCalledWith({
      spokenText: originalLine.spokenText,
      pronunciation: originalLine.pronunciation
    });
    expect(originalLine).toEqual(lineSnapshot);
    expect(originalCharacter).toEqual(characterSnapshot);

    const storedPath = path.join(workspaceRoot, ...first.queryPath.split("/"));
    const storedQuery = JSON.parse(await fs.readFile(storedPath, "utf8")) as {
      speedScale: number;
      pitchScale: number;
      intonationScale: number;
      volumeScale: number;
      prePhonemeLength: number;
      postPhonemeLength: number;
      generated_for: string;
      generated_style_id: number;
      future_query_field: unknown;
    };
    expect(storedQuery).toMatchObject({
      speedScale: 1.2,
      pitchScale: originalCharacter.voice.pitchScale,
      intonationScale: originalCharacter.voice.intonationScale,
      volumeScale: 0.8,
      prePhonemeLength: originalCharacter.voice.prePhonemeLength,
      postPhonemeLength: originalCharacter.voice.postPhonemeLength,
      generated_for: first.resolvedSpokenText,
      generated_style_id: resolvedSpeaker.resolvedStyleId,
      future_query_field: { preserve: true }
    });

    const second = await service.prepare(
      input({
        line: {
          ...originalLine,
          voiceOverrides: { volumeScale: 0.8, speedScale: 1.2 }
        }
      })
    );
    expect(second.cached).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.query).toEqual(first.query);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(1);
  });

  it("creates a new cache entry when a voice override changes", async () => {
    const { workspaceRoot, client, service } = await makeService();
    const originalLine = line();
    if (originalLine === undefined) {
      throw new Error("fixture line is required");
    }

    const first = await service.prepare(
      input({
        line: { ...originalLine, voiceOverrides: { speedScale: 1.1 } }
      })
    );
    const changed = await service.prepare(
      input({
        line: { ...originalLine, voiceOverrides: { speedScale: 1.2 } }
      })
    );

    expect(changed.cached).toBe(false);
    expect(changed.cacheKey).not.toBe(first.cacheKey);
    expect(changed.queryPath).not.toBe(first.queryPath);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(2);
    const cacheDirectory = path.join(
      workspaceRoot,
      "projects",
      videoProjectFixture.metadata.id,
      "cache",
      "voicevox-query"
    );
    expect((await fs.readdir(cacheDirectory)).sort()).toEqual(
      [
        `${originalLine.id}-${first.cacheKey}.json`,
        `${originalLine.id}-${changed.cacheKey}.json`
      ].sort()
    );
  });

  it("regenerates an invalid cache file instead of treating it as a hit", async () => {
    const { workspaceRoot, client, service } = await makeService();
    const first = await service.prepare(input());
    const storedPath = path.join(workspaceRoot, ...first.queryPath.split("/"));
    await fs.writeFile(storedPath, '{"incomplete":', "utf8");

    const regenerated = await service.prepare(input());

    expect(regenerated.cached).toBe(false);
    expect(regenerated.cacheKey).toBe(first.cacheKey);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await fs.readFile(storedPath, "utf8"))).toMatchObject({
      speedScale: 1
    });
    expect(
      (await fs.readdir(path.dirname(storedPath))).some((name) =>
        name.endsWith(".tmp")
      )
    ).toBe(false);
  });

  it("revalidates a directory when mkdir reports a concurrent EEXIST", async () => {
    const { workspaceRoot, client, terminologyService } = await makeService();
    let reportedConcurrentCreation = false;
    const cache = new VoicevoxQueryCache({
      workspaceRoot,
      fileSystem: {
        mkdir: async (directoryPath, options) => {
          await fs.mkdir(directoryPath, {
            recursive: options?.recursive ?? false
          });
          if (options?.recursive === false && !reportedConcurrentCreation) {
            reportedConcurrentCreation = true;
            throw Object.assign(new Error("directory already exists"), {
              code: "EEXIST"
            });
          }
        }
      }
    });
    const service = new VoicevoxQueryService({
      client,
      terminologyService,
      cache
    });

    await expect(service.prepare(input())).resolves.toMatchObject({
      cached: false
    });
    expect(reportedConcurrentCreation).toBe(true);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps literal and excluded-term behavior in the existing resolver", async () => {
    const { client, service } = await makeService();
    const originalLine = line();
    if (originalLine === undefined) {
      throw new Error("fixture line is required");
    }

    const literal = await service.prepare(
      input({
        line: {
          ...originalLine,
          spokenText: "申請",
          pronunciation: { mode: "literal", excludedTermIds: [] }
        }
      })
    );
    const excluded = await service.prepare(
      input({
        line: {
          ...originalLine,
          spokenText: "申請",
          pronunciation: {
            mode: "dictionary",
            excludedTermIds: [term.termId]
          }
        }
      })
    );

    expect(literal.resolvedSpokenText).toBe("申請");
    expect(literal.appliedTerms).toEqual([]);
    expect(excluded.resolvedSpokenText).toBe("申請");
    expect(excluded.appliedTerms).toEqual([]);
    expect(excluded.cached).toBe(true);
    expect(client.getAudioQuery).toHaveBeenCalledTimes(1);
    expect(client.getAudioQuery).toHaveBeenCalledWith("申請", 10_001);
  });

  it("rejects invalid IDs before using the client or an external path", async () => {
    const { client, service } = await makeService();
    await expect(
      service.prepare(input({ projectId: "../outside" }))
    ).rejects.toThrow();

    const originalLine = line();
    if (originalLine === undefined) {
      throw new Error("fixture line is required");
    }
    await expect(
      service.prepare(input({ line: { ...originalLine, id: "../outside" } }))
    ).rejects.toThrow();
    expect(client.getVersion).not.toHaveBeenCalled();

    const cache = new VoicevoxQueryCache({
      workspaceRoot: "C:\\fixture-workspace"
    });
    expect(() =>
      cache.getQueryPath({
        projectId: "../outside",
        lineId: "line-one",
        cacheKey: "0".repeat(64)
      })
    ).toThrow();
  });
});
