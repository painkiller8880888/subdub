import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VoicevoxAudioService,
  type GenerateVoicevoxAudioInput
} from "../../src/app/voicevox/audio-service.js";
import {
  VoicevoxAudioStore,
  type VoicevoxAudioStoreFileSystem
} from "../../src/app/voicevox/audio-store.js";
import { VoicevoxWavError } from "../../src/voicevox/wav.js";
import { VoicevoxAdapterError } from "../../src/voicevox/errors.js";
import type { AppliedTerminology } from "../../src/app/terminology/spoken-text-resolver.js";
import type { Character, ScriptLine } from "../../src/schema/index.js";
import type { VoicevoxResolvedSpeaker } from "../../src/voicevox/schemas.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxWavFixture
} from "../fixtures/voicevox.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = videoProjectFixture.metadata.id;
const firstLine = videoProjectFixture.script.sections[0]!.lines[0]!;
const secondLine = videoProjectFixture.script.sections[0]!.lines[1]!;
const firstCharacter = videoProjectFixture.characters[0]!;
const secondCharacter = videoProjectFixture.characters[1]!;
const fixedNow = new Date("2026-08-10T08:00:00.000Z");

const firstSpeaker: VoicevoxResolvedSpeaker = {
  speakerName: "四国めたん",
  speakerUuid: "metan-fixture-uuid",
  styleName: "ノーマル",
  resolvedStyleId: 1_234
} as const;

const secondSpeaker: VoicevoxResolvedSpeaker = {
  speakerName: "ずんだもん",
  speakerUuid: "zundamon-fixture-uuid",
  styleName: "ノーマル",
  resolvedStyleId: 5_678
} as const;

const roots: string[] = [];

function createNodeFileSystem(
  failure:
    | { readonly kind: "wav-write" }
    | { readonly kind: "wav-rename" }
    | { readonly kind: "index-write" }
    | { readonly kind: "index-rename" }
    | null = null
): VoicevoxAudioStoreFileSystem {
  return {
    mkdir: async (directoryPath, options) => {
      await fs.mkdir(directoryPath, options);
    },
    readFile: (filePath) => fs.readFile(filePath),
    readTextFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
    writeFile: async (filePath, contents) => {
      if (
        (failure?.kind === "wav-write" && filePath.includes(".wav.")) ||
        (failure?.kind === "index-write" &&
          filePath.includes("audio-index.json."))
      ) {
        throw new Error("injected write failure");
      }
      if (typeof contents === "string") {
        await fs.writeFile(filePath, contents, {
          encoding: "utf8",
          flag: "wx"
        });
      } else {
        await fs.writeFile(filePath, contents, { flag: "wx" });
      }
    },
    rename: async (sourcePath, destinationPath) => {
      if (
        (failure?.kind === "wav-rename" && destinationPath.endsWith(".wav")) ||
        (failure?.kind === "index-rename" &&
          destinationPath.endsWith("audio-index.json"))
      ) {
        throw new Error("injected rename failure");
      }
      await fs.rename(sourcePath, destinationPath);
    },
    unlink: (filePath) => fs.unlink(filePath),
    realpath: (filePath) => fs.realpath(filePath)
  };
}

function createPrepared(
  line: ScriptLine,
  speaker: VoicevoxResolvedSpeaker,
  cacheKey: string,
  appliedTerms: readonly AppliedTerminology[] = [],
  resolvedSpokenText = line.spokenText
) {
  return {
    cached: false,
    cacheKey,
    queryPath: `projects/${projectId}/cache/voicevox-query/${line.id}-${cacheKey}.json`,
    query: createVoicevoxAudioQueryFixture(),
    resolvedSpokenText,
    appliedTerms,
    voicevoxEngineVersion: "engine-fixture-1",
    resolvedSpeaker: speaker
  };
}

function createInput(
  line: ScriptLine,
  character: Character,
  speaker: VoicevoxResolvedSpeaker,
  sectionOrder = 2,
  lineOrder = 14
): GenerateVoicevoxAudioInput {
  return {
    projectId,
    line,
    character,
    resolvedSpeaker: speaker,
    sectionOrder,
    lineOrder
  };
}

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "subdub-voicevox-audio-"));
  roots.push(root);
  return root;
}

function createService(
  store: VoicevoxAudioStore,
  prepared: ReturnType<typeof createPrepared>,
  audio: Uint8Array,
  synthesize = vi.fn(async () => audio)
) {
  const prepare = vi.fn(async () => prepared);
  return {
    prepare,
    synthesize,
    service: new VoicevoxAudioService({
      queryService: { prepare },
      client: { synthesize },
      audioStore: store
    })
  };
}

async function readIndexRaw(root: string): Promise<string> {
  return fs.readFile(
    path.join(root, "projects", projectId, "cache", "audio-index.json"),
    { encoding: "utf8" }
  );
}

async function readAudio(root: string, audioPath: string): Promise<Uint8Array> {
  return fs.readFile(path.join(root, ...audioPath.split("/")));
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VoicevoxAudioService", () => {
  it("synthesizes, preserves WAV bytes, and writes every audio index field", async () => {
    const root = await createRoot();
    const wav = createVoicevoxWavFixture({ durationMs: 1_250 });
    const cacheKey = "a".repeat(64);
    const appliedTerms = [
      {
        termId: "term-voicevox",
        surface: "申請",
        reading: "シンセイ",
        termUpdatedAt: "2026-08-09T00:00:00.000Z"
      }
    ];
    const prepared = createPrepared(
      firstLine,
      firstSpeaker,
      cacheKey,
      appliedTerms,
      "シンセイメニュー"
    );
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const harness = createService(store, prepared, wav);

    const entry = await harness.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );

    expect(harness.prepare).toHaveBeenCalledWith({
      projectId,
      line: firstLine,
      character: firstCharacter,
      resolvedSpeaker: firstSpeaker
    });
    expect(harness.synthesize).toHaveBeenCalledWith(
      prepared.query,
      firstSpeaker.resolvedStyleId
    );
    expect(entry).toMatchObject({
      lineId: firstLine.id,
      audioPath: `projects/${projectId}/audio/voice/02-014_${firstLine.id}_spk${firstSpeaker.resolvedStyleId}_${cacheKey.slice(0, 8)}.wav`,
      cacheKey,
      durationMs: 1_250,
      generatedAt: fixedNow.toISOString(),
      voicevoxEngineVersion: prepared.voicevoxEngineVersion,
      speakerUuid: firstSpeaker.speakerUuid,
      styleName: firstSpeaker.styleName,
      resolvedStyleId: firstSpeaker.resolvedStyleId,
      resolvedSpokenText: "シンセイメニュー",
      appliedTerms,
      queryPath: prepared.queryPath
    });
    expect(Array.from(await readAudio(root, entry.audioPath))).toEqual(
      Array.from(wav)
    );
    expect(JSON.parse(await readIndexRaw(root))).toEqual({
      [firstLine.id]: entry
    });
  });

  it("keeps other line entries while replacing only the target line", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const first = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 1_000 })
    );
    const firstEntry = await first.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const second = createService(
      store,
      createPrepared(secondLine, secondSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 750 })
    );
    const secondEntry = await second.service.generate(
      createInput(secondLine, secondCharacter, secondSpeaker, 2, 15)
    );
    const replacement = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "c".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 1_500 })
    );
    const replacementEntry = await replacement.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );

    expect(JSON.parse(await readIndexRaw(root))).toEqual({
      [firstLine.id]: replacementEntry,
      [secondLine.id]: secondEntry
    });
    expect(firstEntry.audioPath).not.toBe(replacementEntry.audioPath);
    expect(
      await fs.stat(path.join(root, ...firstEntry.audioPath.split("/")))
    ).toBeDefined();
  });

  it("serializes concurrent saves for a project and keeps both line entries", async () => {
    const root = await createRoot();
    const baseFileSystem = createNodeFileSystem();
    const fileSystem: VoicevoxAudioStoreFileSystem = {
      ...baseFileSystem,
      readTextFile: async (filePath) => {
        if (filePath.endsWith("audio-index.json")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return baseFileSystem.readTextFile(filePath);
      }
    };
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      fileSystem,
      now: () => fixedNow
    });
    const first = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const second = createService(
      store,
      createPrepared(secondLine, secondSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 750 })
    );

    await expect(
      Promise.all([
        first.service.generate(
          createInput(firstLine, firstCharacter, firstSpeaker)
        ),
        second.service.generate(
          createInput(secondLine, secondCharacter, secondSpeaker, 2, 15)
        )
      ])
    ).resolves.toHaveLength(2);
    expect(Object.keys(JSON.parse(await readIndexRaw(root))).sort()).toEqual(
      [firstLine.id, secondLine.id].sort()
    );
  });

  it.each([
    [
      "connection failure",
      new VoicevoxAdapterError("VOICEVOX_CONNECTION_FAILED")
    ],
    ["timeout", new VoicevoxAdapterError("VOICEVOX_TIMEOUT")],
    [
      "HTTP failure",
      new VoicevoxAdapterError("VOICEVOX_HTTP_FAILED", { upstreamStatus: 503 })
    ]
  ])("keeps prior artifacts when synthesis has a %s", async (_label, error) => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const success = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const priorEntry = await success.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const priorIndex = await readIndexRaw(root);
    const priorWav = await readAudio(root, priorEntry.audioPath);
    const failed = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture(),
      vi.fn(async () => {
        throw error;
      })
    );

    await expect(
      failed.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toBe(error);
    expect(await readIndexRaw(root)).toBe(priorIndex);
    expect(Array.from(await readAudio(root, priorEntry.audioPath))).toEqual(
      Array.from(priorWav)
    );
  });

  it("rejects an invalid WAV without changing the existing index", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const success = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const priorEntry = await success.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const priorIndex = await readIndexRaw(root);
    const failed = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "b".repeat(64)),
      new Uint8Array([1, 2, 3])
    );

    await expect(
      failed.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toBeInstanceOf(VoicevoxWavError);
    expect(await readIndexRaw(root)).toBe(priorIndex);
    expect(
      await fs.stat(path.join(root, ...priorEntry.audioPath.split("/")))
    ).toBeDefined();
  });

  it.each([
    ["WAV write", { kind: "wav-write" as const }],
    ["WAV rename", { kind: "wav-rename" as const }]
  ])("keeps prior artifacts when %s fails", async (_label, failure) => {
    const root = await createRoot();
    const successStore = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const success = createService(
      successStore,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const priorEntry = await success.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const priorIndex = await readIndexRaw(root);
    const priorWav = await readAudio(root, priorEntry.audioPath);
    const failedStore = new VoicevoxAudioStore({
      workspaceRoot: root,
      fileSystem: createNodeFileSystem(failure),
      now: () => fixedNow
    });
    const failed = createService(
      failedStore,
      createPrepared(firstLine, firstSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 1_500 })
    );

    await expect(
      failed.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toMatchObject({
      code:
        failure.kind === "wav-write"
          ? "VOICEVOX_AUDIO_STORE_WAV_WRITE_FAILED"
          : "VOICEVOX_AUDIO_STORE_WAV_RENAME_FAILED"
    });
    expect(await readIndexRaw(root)).toBe(priorIndex);
    expect(Array.from(await readAudio(root, priorEntry.audioPath))).toEqual(
      Array.from(priorWav)
    );
  });

  it.each([
    ["index write", { kind: "index-write" as const }],
    ["index rename", { kind: "index-rename" as const }]
  ])("keeps prior index and WAV when %s fails", async (_label, failure) => {
    const root = await createRoot();
    const successStore = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const success = createService(
      successStore,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const priorEntry = await success.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const priorIndex = await readIndexRaw(root);
    const priorWav = await readAudio(root, priorEntry.audioPath);
    const failedStore = new VoicevoxAudioStore({
      workspaceRoot: root,
      fileSystem: createNodeFileSystem(failure),
      now: () => fixedNow
    });
    const newCacheKey = "b".repeat(64);
    const failed = createService(
      failedStore,
      createPrepared(firstLine, firstSpeaker, newCacheKey),
      createVoicevoxWavFixture({ durationMs: 1_500 })
    );

    await expect(
      failed.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toMatchObject({
      code:
        failure.kind === "index-write"
          ? "VOICEVOX_AUDIO_STORE_INDEX_WRITE_FAILED"
          : "VOICEVOX_AUDIO_STORE_INDEX_RENAME_FAILED"
    });
    expect(await readIndexRaw(root)).toBe(priorIndex);
    expect(Array.from(await readAudio(root, priorEntry.audioPath))).toEqual(
      Array.from(priorWav)
    );
    const newAudioPath = failedStore.getAudioPath({
      projectId,
      lineId: firstLine.id,
      sectionOrder: 2,
      lineOrder: 14,
      cacheKey: newCacheKey,
      resolvedStyleId: firstSpeaker.resolvedStyleId
    });
    await expect(readAudio(root, newAudioPath)).rejects.toBeDefined();
  });

  it("preserves a malformed existing index instead of treating it as empty", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const success = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const priorEntry = await success.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const indexPath = path.join(
      root,
      "projects",
      projectId,
      "cache",
      "audio-index.json"
    );
    await fs.writeFile(indexPath, '{"broken":true}\n', "utf8");
    const malformedIndex = await readIndexRaw(root);
    const failed = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 1_500 })
    );

    await expect(
      failed.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toMatchObject({ code: "VOICEVOX_AUDIO_STORE_INDEX_INVALID" });
    expect(await readIndexRaw(root)).toBe(malformedIndex);
    expect(
      await fs.stat(path.join(root, ...priorEntry.audioPath.split("/")))
    ).toBeDefined();
  });

  it("filters invalid audio entries outside the requested render lines", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const harness = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const enabledEntry = await harness.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const indexPath = path.join(
      root,
      "projects",
      projectId,
      "cache",
      "audio-index.json"
    );
    const rawIndex = JSON.parse(await readIndexRaw(root)) as Record<
      string,
      unknown
    >;
    rawIndex["disabled-line"] = {
      ...(rawIndex[firstLine.id] as Record<string, unknown>),
      lineId: "disabled-line",
      audioPath: "../outside.wav"
    };
    await fs.writeFile(indexPath, `${JSON.stringify(rawIndex)}\n`, "utf8");

    await expect(
      store.readIndex(projectId, { lineIds: new Set([firstLine.id]) })
    ).resolves.toEqual({ [firstLine.id]: enabledEntry });

    await fs.writeFile(indexPath, "{broken\n", "utf8");
    await expect(
      store.readIndex(projectId, { lineIds: new Set() })
    ).resolves.toEqual({});
  });

  it("rejects unsafe IDs and cache keys before filesystem access", async () => {
    const root = await createRoot();
    const realpath = vi.fn(async () => {
      throw new Error("filesystem must not be touched");
    });
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      fileSystem: { realpath },
      now: () => fixedNow
    });
    const prepared = createPrepared(firstLine, firstSpeaker, "not-a-cache-key");
    const harness = createService(store, prepared, createVoicevoxWavFixture());

    await expect(
      harness.service.generate({
        ...createInput(firstLine, firstCharacter, firstSpeaker),
        projectId: "../outside"
      })
    ).rejects.toBeDefined();
    expect(realpath).not.toHaveBeenCalled();

    await expect(
      harness.service.generate(
        createInput(firstLine, firstCharacter, firstSpeaker)
      )
    ).rejects.toMatchObject({ code: "VOICEVOX_AUDIO_STORE_INPUT_INVALID" });
    expect(realpath).not.toHaveBeenCalled();
  });

  it("rejects a project symlink that resolves outside the workspace", async () => {
    const root = await createRoot();
    const outside = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-voicevox-outside-")
    );
    try {
      const projectsPath = path.join(root, "projects");
      try {
        await fs.symlink(
          outside,
          projectsPath,
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
      const store = new VoicevoxAudioStore({
        workspaceRoot: root,
        now: () => fixedNow
      });
      const harness = createService(
        store,
        createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
        createVoicevoxWavFixture()
      );

      await expect(
        harness.service.generate(
          createInput(firstLine, firstCharacter, firstSpeaker)
        )
      ).rejects.toMatchObject({ code: "VOICEVOX_AUDIO_STORE_PATH_INVALID" });
      await expect(fs.readdir(outside)).resolves.toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("does not rewrite an existing WAV for an idempotent cache-key rerun", async () => {
    const root = await createRoot();
    let wavWrites = 0;
    const fileSystem = createNodeFileSystem();
    const originalWriteFile = fileSystem.writeFile;
    fileSystem.writeFile = async (filePath, contents) => {
      if (filePath.includes(".wav.")) {
        wavWrites += 1;
      }
      await originalWriteFile(filePath, contents);
    };
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      fileSystem,
      now: () => fixedNow
    });
    const wav = createVoicevoxWavFixture();
    const harness = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      wav
    );
    const firstEntry = await harness.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const secondEntry = await harness.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );

    expect(wavWrites).toBe(1);
    expect(secondEntry.audioPath).toBe(firstEntry.audioPath);
    expect(Array.from(await readAudio(root, firstEntry.audioPath))).toEqual(
      Array.from(wav)
    );
  });

  it("keeps every prior line when another line fails", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const first = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    const second = createService(
      store,
      createPrepared(secondLine, secondSpeaker, "b".repeat(64)),
      createVoicevoxWavFixture({ durationMs: 750 })
    );
    const firstEntry = await first.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );
    const secondEntry = await second.service.generate(
      createInput(secondLine, secondCharacter, secondSpeaker, 2, 15)
    );
    const priorIndex = await readIndexRaw(root);
    const failed = createService(
      store,
      createPrepared(secondLine, secondSpeaker, "c".repeat(64)),
      createVoicevoxWavFixture(),
      vi.fn(async () => {
        throw new VoicevoxAdapterError("VOICEVOX_CONNECTION_FAILED");
      })
    );

    await expect(
      failed.service.generate(
        createInput(secondLine, secondCharacter, secondSpeaker, 2, 15)
      )
    ).rejects.toBeInstanceOf(VoicevoxAdapterError);
    expect(await readIndexRaw(root)).toBe(priorIndex);
    expect(
      await fs.stat(path.join(root, ...firstEntry.audioPath.split("/")))
    ).toBeDefined();
    expect(
      await fs.stat(path.join(root, ...secondEntry.audioPath.split("/")))
    ).toBeDefined();
  });

  it("removes temporary files after a successful generation", async () => {
    const root = await createRoot();
    const store = new VoicevoxAudioStore({
      workspaceRoot: root,
      now: () => fixedNow
    });
    const harness = createService(
      store,
      createPrepared(firstLine, firstSpeaker, "a".repeat(64)),
      createVoicevoxWavFixture()
    );
    await harness.service.generate(
      createInput(firstLine, firstCharacter, firstSpeaker)
    );

    const tmpFiles: string[] = [];
    async function collect(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true
      })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await collect(entryPath);
        } else if (entry.name.endsWith(".tmp")) {
          tmpFiles.push(entryPath);
        }
      }
    }
    await collect(root);
    expect(tmpFiles).toEqual([]);
  });
});
