import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  strictObject
} from "../../schema/index.js";
import {
  voicevoxAudioIndexEntrySchema,
  voicevoxAudioIndexSchema,
  voicevoxAppliedTermSchema,
  voicevoxAudioCacheKeySchema,
  type VoicevoxAudioIndex,
  type VoicevoxAudioIndexEntry
} from "./audio-index.js";
import { inspectVoicevoxWav } from "./wav-metadata.js";
import {
  voicevoxAudioQuerySchema,
  voicevoxResolvedSpeakerSchema
} from "../../voicevox/schemas.js";

export const VOICEVOX_AUDIO_RELATIVE_DIRECTORY = "audio/voice" as const;
export const VOICEVOX_AUDIO_INDEX_RELATIVE_PATH =
  "cache/audio-index.json" as const;

const audioPathInputSchema = strictObject({
  projectId: idSchema,
  lineId: idSchema,
  sectionOrder: positiveIntegerSchema,
  lineOrder: positiveIntegerSchema,
  cacheKey: voicevoxAudioCacheKeySchema,
  resolvedStyleId: z.number().finite().int()
});

export type VoicevoxAudioStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<Uint8Array>;
  readTextFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: Uint8Array | string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
};

const defaultFileSystem: VoicevoxAudioStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath),
  readTextFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
  writeFile: (filePath, contents) => {
    if (typeof contents === "string") {
      return fs.writeFile(filePath, contents, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    return fs.writeFile(filePath, contents, { flag: "wx" });
  },
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

export type VoicevoxAudioStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<VoicevoxAudioStoreFileSystem>;
  readonly now?: () => Date;
};

export type VoicevoxAudioIndexReadOptions = Readonly<{
  /** Restrict validation and returned entries to the current render lines. */
  readonly lineIds?: ReadonlySet<string>;
}>;

export type VoicevoxAudioStoreInput = {
  readonly projectId: unknown;
  readonly lineId: unknown;
  readonly sectionOrder: unknown;
  readonly lineOrder: unknown;
  readonly prepared: {
    readonly cacheKey: unknown;
    readonly queryPath: unknown;
    readonly resolvedSpokenText: unknown;
    readonly appliedTerms: unknown;
    readonly voicevoxEngineVersion: unknown;
    readonly resolvedSpeaker: unknown;
  };
  readonly audioBytes: unknown;
};

export type VoicevoxAudioStoreErrorCode =
  | "VOICEVOX_AUDIO_STORE_INPUT_INVALID"
  | "VOICEVOX_AUDIO_STORE_PATH_INVALID"
  | "VOICEVOX_AUDIO_STORE_READ_FAILED"
  | "VOICEVOX_AUDIO_STORE_INDEX_INVALID"
  | "VOICEVOX_AUDIO_STORE_WAV_WRITE_FAILED"
  | "VOICEVOX_AUDIO_STORE_WAV_RENAME_FAILED"
  | "VOICEVOX_AUDIO_STORE_INDEX_WRITE_FAILED"
  | "VOICEVOX_AUDIO_STORE_INDEX_RENAME_FAILED"
  | "VOICEVOX_AUDIO_STORE_AUDIO_CONFLICT";

export class VoicevoxAudioStoreError extends Error {
  readonly code: VoicevoxAudioStoreErrorCode;

  constructor(code: VoicevoxAudioStoreErrorCode) {
    super(code);
    this.name = "VoicevoxAudioStoreError";
    this.code = code;
  }
}

type ParsedInput = {
  readonly projectId: string;
  readonly lineId: string;
  readonly sectionOrder: number;
  readonly lineOrder: number;
  readonly cacheKey: string;
  readonly queryPath: string;
  readonly resolvedSpokenText: string;
  readonly appliedTerms: z.infer<typeof voicevoxAppliedTermSchema>[];
  readonly voicevoxEngineVersion: string;
  readonly resolvedSpeaker: z.infer<typeof voicevoxResolvedSpeakerSchema>;
  readonly audioBytes: Uint8Array;
};

type AudioPaths = {
  readonly audioRelativePath: string;
  readonly audioFilePath: string;
  readonly indexRelativePath: string;
  readonly indexFilePath: string;
};

const projectAudioUpdateLocks = new Map<string, Promise<void>>();

function getFileSystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return getFileSystemErrorCode(error) === "ENOENT";
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function padOrder(order: number, width: number): string {
  return String(order).padStart(width, "0");
}

function areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function sortedIndex(index: VoicevoxAudioIndex): VoicevoxAudioIndex {
  const sorted: Record<string, VoicevoxAudioIndexEntry> = {};
  for (const lineId of Object.keys(index).sort()) {
    const entry = index[lineId];
    if (entry !== undefined) {
      sorted[lineId] = entry;
    }
  }
  return sorted;
}

function serializeIndex(index: VoicevoxAudioIndex): string {
  return `${JSON.stringify(sortedIndex(index), null, 2)}\n`;
}

function validateIndexPaths(
  projectId: string,
  index: VoicevoxAudioIndex
): VoicevoxAudioIndex {
  const audioPrefix = `projects/${projectId}/${VOICEVOX_AUDIO_RELATIVE_DIRECTORY}/`;
  const queryPrefix = `projects/${projectId}/cache/voicevox-query/`;
  for (const entry of Object.values(index)) {
    if (
      !entry.audioPath.startsWith(audioPrefix) ||
      !entry.queryPath.startsWith(queryPrefix)
    ) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INDEX_INVALID");
    }
  }
  return index;
}

export class VoicevoxAudioStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: VoicevoxAudioStoreFileSystem;
  private readonly now: () => Date;

  constructor(options: VoicevoxAudioStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.now = options.now ?? (() => new Date());
  }

  getAudioPath(input: {
    readonly projectId: unknown;
    readonly lineId: unknown;
    readonly sectionOrder: unknown;
    readonly lineOrder: unknown;
    readonly cacheKey: unknown;
    readonly resolvedStyleId: unknown;
  }): string {
    const parsed = audioPathInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INPUT_INVALID");
    }

    return this.audioRelativePath(parsed.data);
  }

  async readIndex(
    projectId: unknown,
    options: VoicevoxAudioIndexReadOptions = {}
  ): Promise<VoicevoxAudioIndex> {
    const parsedProjectId = idSchema.safeParse(projectId);
    if (!parsedProjectId.success) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INPUT_INVALID");
    }

    return this.withProjectAudioUpdateLock(parsedProjectId.data, () =>
      this.readIndexUnlocked(parsedProjectId.data, options.lineIds)
    );
  }

  private async readIndexUnlocked(
    projectId: string,
    lineIds?: ReadonlySet<string>
  ): Promise<VoicevoxAudioIndex> {
    const parsedProjectId = idSchema.parse(projectId);

    if (lineIds !== undefined && lineIds.size === 0) {
      return {};
    }

    const relativePath = `projects/${parsedProjectId}/${VOICEVOX_AUDIO_INDEX_RELATIVE_PATH}`;
    const filePath = await this.resolveExistingFilePath(relativePath);
    if (filePath === null) {
      return {};
    }

    let contents: string;
    try {
      contents = await this.fileSystem.readTextFile(filePath);
    } catch {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_READ_FAILED");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INDEX_INVALID");
    }

    const effectiveJson =
      lineIds === undefined ||
      typeof parsedJson !== "object" ||
      parsedJson === null ||
      Array.isArray(parsedJson)
        ? parsedJson
        : Object.fromEntries(
            Object.entries(parsedJson).filter(([lineId]) => lineIds.has(lineId))
          );
    const parsedIndex = voicevoxAudioIndexSchema.safeParse(effectiveJson);
    if (!parsedIndex.success) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INDEX_INVALID");
    }

    const validatedIndex = validateIndexPaths(
      parsedProjectId,
      parsedIndex.data
    );
    for (const entry of Object.values(validatedIndex)) {
      await this.resolveExistingFilePath(entry.audioPath);
      await this.resolveExistingFilePath(entry.queryPath);
    }
    return validatedIndex;
  }

  /**
   * Check the derived files referenced by one index entry without mutating
   * them. A missing, malformed, or checksum-mismatched artifact is simply not
   * current; callers can then safely treat the line as stale.
   */
  async isEntryUsable(projectId: unknown, entry: unknown): Promise<boolean> {
    const parsedProjectId = idSchema.safeParse(projectId);
    const parsedEntry = voicevoxAudioIndexEntrySchema.safeParse(entry);
    if (!parsedProjectId.success || !parsedEntry.success) {
      return false;
    }

    return this.withProjectAudioUpdateLock(parsedProjectId.data, () =>
      this.isEntryUsableUnlocked(parsedProjectId.data, parsedEntry.data)
    );
  }

  private async isEntryUsableUnlocked(
    projectId: string,
    entry: VoicevoxAudioIndexEntry
  ): Promise<boolean> {
    const parsedProjectId = idSchema.parse(projectId);

    try {
      validateIndexPaths(parsedProjectId, {
        [entry.lineId]: entry
      });
      const audioPath = await this.resolveExistingFilePath(entry.audioPath);
      const queryPath = await this.resolveExistingFilePath(entry.queryPath);
      if (audioPath === null || queryPath === null) {
        return false;
      }

      const audioBytes = await this.fileSystem.readFile(audioPath);
      const metadata = inspectVoicevoxWav(audioBytes);
      if (
        metadata.audioSha256 !== entry.audioSha256 ||
        metadata.durationMs !== entry.durationMs
      ) {
        return false;
      }

      const queryContents = await this.fileSystem.readTextFile(queryPath);
      const parsedQuery = voicevoxAudioQuerySchema.safeParse(
        JSON.parse(queryContents) as unknown
      );
      return parsedQuery.success;
    } catch {
      return false;
    }
  }

  async save(input: VoicevoxAudioStoreInput): Promise<VoicevoxAudioIndexEntry> {
    const parsed = this.parseInput(input);
    const wavMetadata = inspectVoicevoxWav(parsed.audioBytes);
    return this.withProjectAudioUpdateLock(parsed.projectId, () =>
      this.saveLocked(parsed, wavMetadata)
    );
  }

  private async saveLocked(
    parsed: ParsedInput,
    wavMetadata: ReturnType<typeof inspectVoicevoxWav>
  ): Promise<VoicevoxAudioIndexEntry> {
    const paths = await this.resolvePaths(parsed);
    const generatedAt = isoUtcDateTimeSchema.parse(this.now().toISOString());
    const entry = voicevoxAudioIndexEntrySchema.parse({
      lineId: parsed.lineId,
      audioPath: paths.audioRelativePath,
      cacheKey: parsed.cacheKey,
      audioSha256: wavMetadata.audioSha256,
      durationMs: wavMetadata.durationMs,
      generatedAt,
      voicevoxEngineVersion: parsed.voicevoxEngineVersion,
      speakerUuid: parsed.resolvedSpeaker.speakerUuid,
      styleName: parsed.resolvedSpeaker.styleName,
      resolvedStyleId: parsed.resolvedSpeaker.resolvedStyleId,
      resolvedSpokenText: parsed.resolvedSpokenText,
      appliedTerms: parsed.appliedTerms,
      queryPath: parsed.queryPath
    });

    let newlyCreatedAudioPath: string | null = null;
    try {
      const existingAudioPath = await this.resolveExistingFilePath(
        paths.audioRelativePath
      );
      if (existingAudioPath !== null) {
        let existingAudio: Uint8Array;
        try {
          existingAudio = await this.fileSystem.readFile(existingAudioPath);
        } catch {
          throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_READ_FAILED");
        }
        if (!areBytesEqual(existingAudio, parsed.audioBytes)) {
          throw new VoicevoxAudioStoreError(
            "VOICEVOX_AUDIO_STORE_AUDIO_CONFLICT"
          );
        }
      } else {
        const temporaryAudioPath = path.join(
          path.dirname(paths.audioFilePath),
          `.${path.basename(paths.audioFilePath)}.${randomUUID()}.tmp`
        );
        try {
          await this.fileSystem.writeFile(
            temporaryAudioPath,
            parsed.audioBytes
          );
        } catch {
          await this.removeTemporaryFile(temporaryAudioPath);
          throw new VoicevoxAudioStoreError(
            "VOICEVOX_AUDIO_STORE_WAV_WRITE_FAILED"
          );
        }

        try {
          await this.fileSystem.rename(temporaryAudioPath, paths.audioFilePath);
        } catch {
          await this.removeTemporaryFile(temporaryAudioPath);
          throw new VoicevoxAudioStoreError(
            "VOICEVOX_AUDIO_STORE_WAV_RENAME_FAILED"
          );
        }
        newlyCreatedAudioPath = paths.audioFilePath;
      }

      const currentIndex = await this.readIndexUnlocked(parsed.projectId);
      const nextIndex = voicevoxAudioIndexSchema.parse({
        ...currentIndex,
        [parsed.lineId]: entry
      });
      await this.writeIndex(paths.indexFilePath, nextIndex);
      return entry;
    } catch (error) {
      if (newlyCreatedAudioPath !== null) {
        await this.removeTemporaryFile(newlyCreatedAudioPath);
      }
      throw error;
    }
  }

  private async withProjectAudioUpdateLock<T>(
    projectId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${this.workspaceRoot}\u0000${projectId}`;
    const previous = projectAudioUpdateLocks.get(lockKey);
    const waitForPrevious =
      previous?.catch(() => undefined) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = waitForPrevious.then(() => hold);
    projectAudioUpdateLocks.set(lockKey, tail);

    await waitForPrevious;
    try {
      return await operation();
    } finally {
      release?.();
      if (projectAudioUpdateLocks.get(lockKey) === tail) {
        projectAudioUpdateLocks.delete(lockKey);
      }
    }
  }

  private parseInput(input: VoicevoxAudioStoreInput): ParsedInput {
    const prepared = input.prepared;
    const pathInput = audioPathInputSchema.safeParse({
      projectId: input.projectId,
      lineId: input.lineId,
      sectionOrder: input.sectionOrder,
      lineOrder: input.lineOrder,
      cacheKey: prepared.cacheKey,
      resolvedStyleId:
        typeof prepared.resolvedSpeaker === "object" &&
        prepared.resolvedSpeaker !== null &&
        "resolvedStyleId" in prepared.resolvedSpeaker
          ? prepared.resolvedSpeaker.resolvedStyleId
          : undefined
    });
    const queryPath = relativePosixPathSchema.safeParse(prepared.queryPath);
    const spokenText = z.string().min(1).safeParse(prepared.resolvedSpokenText);
    const appliedTerms = z
      .array(voicevoxAppliedTermSchema)
      .safeParse(prepared.appliedTerms);
    const engineVersion = z
      .string()
      .min(1)
      .safeParse(prepared.voicevoxEngineVersion);
    const resolvedSpeaker = voicevoxResolvedSpeakerSchema.safeParse(
      prepared.resolvedSpeaker
    );
    const audioBytes =
      input.audioBytes instanceof Uint8Array
        ? new Uint8Array(input.audioBytes)
        : null;

    if (
      !pathInput.success ||
      !queryPath.success ||
      !spokenText.success ||
      !appliedTerms.success ||
      !engineVersion.success ||
      !resolvedSpeaker.success ||
      audioBytes === null
    ) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_INPUT_INVALID");
    }

    return {
      projectId: pathInput.data.projectId,
      lineId: pathInput.data.lineId,
      sectionOrder: pathInput.data.sectionOrder,
      lineOrder: pathInput.data.lineOrder,
      cacheKey: pathInput.data.cacheKey,
      queryPath: queryPath.data,
      resolvedSpokenText: spokenText.data,
      appliedTerms: appliedTerms.data,
      voicevoxEngineVersion: engineVersion.data,
      resolvedSpeaker: resolvedSpeaker.data,
      audioBytes
    };
  }

  private audioRelativePath(
    input: z.infer<typeof audioPathInputSchema>
  ): string {
    const relativePath =
      `projects/${input.projectId}/${VOICEVOX_AUDIO_RELATIVE_DIRECTORY}/` +
      `${padOrder(input.sectionOrder, 2)}-${padOrder(input.lineOrder, 3)}_` +
      `${input.lineId}_spk${input.resolvedStyleId}_${input.cacheKey.slice(0, 8)}.wav`;
    const parsedPath = relativePosixPathSchema.safeParse(relativePath);
    if (!parsedPath.success) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
    return parsedPath.data;
  }

  private async resolvePaths(input: ParsedInput): Promise<AudioPaths> {
    const audioRelativePath = this.audioRelativePath({
      projectId: input.projectId,
      lineId: input.lineId,
      sectionOrder: input.sectionOrder,
      lineOrder: input.lineOrder,
      cacheKey: input.cacheKey,
      resolvedStyleId: input.resolvedSpeaker.resolvedStyleId
    });
    const indexRelativePath = `projects/${input.projectId}/${VOICEVOX_AUDIO_INDEX_RELATIVE_PATH}`;
    const audioFilePath = this.resolveLexicalPath(audioRelativePath);
    const indexFilePath = this.resolveLexicalPath(indexRelativePath);
    await this.ensureSafeDirectory(path.dirname(audioFilePath));
    return {
      audioRelativePath,
      audioFilePath,
      indexRelativePath,
      indexFilePath
    };
  }

  private async writeIndex(
    indexFilePath: string,
    index: VoicevoxAudioIndex
  ): Promise<void> {
    await this.ensureSafeDirectory(path.dirname(indexFilePath));
    const temporaryFilePath = path.join(
      path.dirname(indexFilePath),
      `.${path.basename(indexFilePath)}.${randomUUID()}.tmp`
    );
    try {
      await this.fileSystem.writeFile(temporaryFilePath, serializeIndex(index));
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new VoicevoxAudioStoreError(
        "VOICEVOX_AUDIO_STORE_INDEX_WRITE_FAILED"
      );
    }

    try {
      await this.fileSystem.rename(temporaryFilePath, indexFilePath);
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new VoicevoxAudioStoreError(
        "VOICEVOX_AUDIO_STORE_INDEX_RENAME_FAILED"
      );
    }
  }

  private async resolveExistingFilePath(
    relativePath: string
  ): Promise<string | null> {
    const filePath = this.resolveLexicalPath(relativePath);
    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      return null;
    }

    const parentPath = path.dirname(filePath);
    const resolvedParentPath = await this.resolveExistingPath(parentPath);
    if (resolvedParentPath === null) {
      return null;
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedParentPath);

    const resolvedFilePath = await this.resolveExistingPath(filePath);
    if (resolvedFilePath === null) {
      return null;
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedFilePath);
    return filePath;
  }

  private async ensureSafeDirectory(directoryPath: string): Promise<void> {
    const managementRootPath = await this.ensureDirectoryAndResolve(
      this.workspaceRoot
    );
    if (!isPathInside(this.workspaceRoot, directoryPath)) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }

    let currentPath = this.workspaceRoot;
    const relativeSegments = path
      .relative(this.workspaceRoot, directoryPath)
      .split(path.sep)
      .filter((segment) => segment.length > 0);
    for (const segment of relativeSegments) {
      currentPath = path.join(currentPath, segment);
      await this.ensureSafeDirectorySegment(currentPath, managementRootPath);
    }
  }

  private async ensureSafeDirectorySegment(
    directoryPath: string,
    managementRootPath: string
  ): Promise<void> {
    const existingPath = await this.resolveExistingPath(directoryPath);
    if (existingPath !== null) {
      this.assertInsideManagementRoot(managementRootPath, existingPath);
      return;
    }

    try {
      await this.fileSystem.mkdir(directoryPath, { recursive: false });
    } catch (error) {
      if (getFileSystemErrorCode(error) !== "EEXIST") {
        throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
      }
      const resolvedPathAfterRace =
        await this.resolveExistingPath(directoryPath);
      if (resolvedPathAfterRace === null) {
        throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
      }
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedPathAfterRace
      );
      return;
    }

    const resolvedPath = await this.resolveExistingPath(directoryPath);
    if (resolvedPath === null) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedPath);
  }

  private async ensureDirectoryAndResolve(
    directoryPath: string
  ): Promise<string> {
    try {
      await this.fileSystem.mkdir(directoryPath, { recursive: true });
      const resolvedPath = await this.fileSystem.realpath(directoryPath);
      if (!isPathInside(directoryPath, resolvedPath)) {
        throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
      }
      return resolvedPath;
    } catch (error) {
      if (error instanceof VoicevoxAudioStoreError) {
        throw error;
      }
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.realpath(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
  }

  private resolveLexicalPath(relativePath: string): string {
    const parsedPath = relativePosixPathSchema.safeParse(relativePath);
    if (!parsedPath.success) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
    const filePath = path.resolve(
      this.workspaceRoot,
      ...parsedPath.data.split("/")
    );
    if (!isPathInside(this.workspaceRoot, filePath)) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
    return filePath;
  }

  private assertInsideManagementRoot(
    managementRootPath: string,
    candidatePath: string
  ): void {
    if (!isPathInside(managementRootPath, candidatePath)) {
      throw new VoicevoxAudioStoreError("VOICEVOX_AUDIO_STORE_PATH_INVALID");
    }
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Cleanup must never hide the operation's original failure.
    }
  }
}

export { VoicevoxAudioStore as VoicevoxAudioIndexStore };
