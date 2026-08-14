import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile as writeFileNode
} from "node:fs/promises";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  characterVisualSetSchema,
  type CharacterVariant,
  type CharacterVariantStatus,
  type CharacterVisualCatalogSnapshot,
  type CharacterVisualFile,
  type CharacterVisualSet,
  type CharacterVisualStatus
} from "../../schema/character-visual.js";
import { idSchema } from "../../schema/primitives.js";
import {
  assertCharacterVisualCatalog,
  expectedCharacterVariantFileKeys
} from "../../validation/character-visuals.js";
import { parsePng, type PngMetadata } from "../../validation/png.js";
import type { CharacterVariantRenderType } from "../../assets/character-asset-manifest.js";
import {
  CharacterVisualApiError,
  CharacterVisualCanvasSizeMismatchError,
  CharacterVisualConflictError,
  CharacterVisualFileTooLargeError,
  CharacterVisualInvalidPngError,
  CharacterVisualMissingSlotError,
  CharacterVisualNotFoundError,
  CharacterVisualStorageError,
  CharacterVisualSeedConflictError,
  CharacterVisualUnsafePathError,
  CharacterVisualUnsupportedFileTypeError,
  CharacterVariantNotFoundError,
  CharacterVisualValidationError
} from "./character-visual-errors.js";
import {
  CharacterVisualRepository,
  type CharacterVariantInsert,
  type CharacterVisualFileInsert,
  type CharacterVisualInsert
} from "./character-visual-repository.js";

export type LegacyCharacterVisualFile = {
  readonly key: string;
  readonly sourceFile: string;
};

export type LegacyCharacterVisualVariant = {
  readonly variantId: string;
  readonly characterId: string;
  readonly label: string;
  readonly renderType: CharacterVariantRenderType;
  readonly tags: readonly string[];
  readonly files: readonly LegacyCharacterVisualFile[];
};

export type CharacterVisualCatalogServiceOptions = {
  readonly repository: CharacterVisualRepository;
  readonly workspaceRoot: string;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly onOrphanDetected?: (
    paths: readonly string[],
    cause: unknown
  ) => void;
};

/** A per-file cap for character PNG uploads, independent of video asset limits. */
export const CHARACTER_VISUAL_MAX_FILE_BYTES = 32 * 1024 * 1024;

export type CharacterVisualCreateInput = {
  readonly name: string;
  readonly description?: string;
  readonly status?: CharacterVisualStatus;
};

export type CharacterVisualUpdateInput = {
  readonly name: string;
  readonly description: string;
  readonly status: CharacterVisualStatus;
};

export type CharacterVisualStagedUpload = {
  /** Staging directory relative to the workspace root. */
  readonly stagingRelativePath: string;
  /** Staged file path relative to the workspace root. */
  readonly fileRelativePath: string;
  readonly sizeBytes: number;
};

export type CharacterVisualUploadFile = {
  readonly key: string;
  /** Used by the HTTP route after streaming the part into workspace staging. */
  readonly staged?: CharacterVisualStagedUpload;
  /** Kept for direct in-process callers and existing service tests. */
  readonly content?: Buffer;
  readonly mimeType?: string;
  readonly filename?: string;
};

export type CharacterVisualVariantInput = {
  readonly label: string;
  readonly renderType: CharacterVariant["renderType"];
  readonly tags: readonly string[];
  readonly files: readonly CharacterVisualUploadFile[];
};

export type CharacterVisualManagedFile = {
  readonly content: Buffer;
  readonly mimeType: CharacterVisualFile["mimeType"];
};

type PreparedSeedFile = {
  readonly variantId: string;
  readonly fileKey: CharacterVisualFile["key"];
  readonly sourcePath: string;
  readonly libraryPath: CharacterVisualFile["libraryPath"];
  readonly mimeType: "image/png";
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
};

type PreparedSeedVariant = {
  readonly visualId: string;
  readonly variantId: string;
  readonly label: string;
  readonly renderType: CharacterVariant["renderType"];
  readonly status: CharacterVariantStatus;
  readonly tags: readonly string[];
  readonly files: readonly PreparedSeedFile[];
};

type PreparedSeedVisual = {
  readonly visualId: string;
  readonly name: string;
  readonly description: string;
  readonly status: CharacterVisualStatus;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly variants: readonly PreparedSeedVariant[];
};

type PreparedUploadedFile = {
  readonly key: CharacterVisualFile["key"];
  readonly stagePath: string;
  readonly targetPath: string;
  readonly libraryPath: CharacterVisualFile["libraryPath"];
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
};

type PreparedVariantFiles = {
  readonly stagingRoots: readonly string[];
  readonly files: readonly PreparedUploadedFile[];
};

function toIsoDate(now: () => Date): string {
  return now().toISOString();
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.includes("\\") &&
    !value
      .split("/")
      .some(
        (segment) => segment.length === 0 || segment === "." || segment === ".."
      )
  );
}

function resolveInside(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new CharacterVisualUnsafePathError(
      `unsafe relative path: ${relativePath}`
    );
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new CharacterVisualUnsafePathError(
      `path escapes managed root: ${relativePath}`
    );
  }
  return resolved;
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isTruncated(stream: Readable): boolean {
  return (stream as Readable & { truncated?: unknown }).truncated === true;
}

function isMultipartUploadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "FST_REQ_FILE_TOO_LARGE" ||
    error.code === "FST_MP_PREMATURE_CLOSE" ||
    error.code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

function createUploadSizeLimiter(): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      const chunkBytes =
        typeof chunk === "string"
          ? Buffer.byteLength(chunk, encoding)
          : chunk instanceof Uint8Array
            ? chunk.byteLength
            : Buffer.byteLength(String(chunk), encoding);
      bytes += chunkBytes;
      if (bytes > CHARACTER_VISUAL_MAX_FILE_BYTES) {
        callback(new CharacterVisualFileTooLargeError());
        return;
      }
      callback(null, chunk);
    }
  });
}

async function collectFiles(
  absoluteRoot: string,
  relativeRoot: string
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(absoluteRoot, entry.name);
    const relativePath = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativePath)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function readRegularFile(filePath: string): Promise<Buffer> {
  let fileStats;
  try {
    fileStats = await lstat(filePath);
  } catch (error) {
    throw new CharacterVisualValidationError(
      `character visual source file is missing: ${filePath}`,
      error
    );
  }
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new CharacterVisualValidationError(
      `character visual source file must be a regular file: ${filePath}`
    );
  }
  return readFile(filePath);
}

async function assertNoSymlinkComponents(
  root: string,
  relativePath: string
): Promise<void> {
  let currentPath = path.resolve(root);
  for (const segment of relativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    try {
      const currentStats = await lstat(currentPath);
      if (currentStats.isSymbolicLink()) {
        throw new CharacterVisualUnsafePathError(
          `managed character visual path must not contain a symlink: ${relativePath}`
        );
      }
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }
  }
}

function inspectPng(
  buffer: Buffer,
  sourcePath: string
): {
  readonly metadata: PngMetadata;
  readonly checksum: string;
} {
  const parsed = parsePng(buffer);
  if (typeof parsed === "string") {
    throw new CharacterVisualValidationError(
      `invalid PNG at ${sourcePath}: ${parsed}`
    );
  }
  if (!parsed.hasAlpha) {
    throw new CharacterVisualValidationError(
      `PNG at ${sourcePath} must declare alpha transparency`
    );
  }
  return {
    metadata: parsed,
    checksum: createHash("sha256").update(buffer).digest("hex")
  };
}

function inspectUploadedPng(
  buffer: Buffer,
  mimeType: string | undefined
): { readonly metadata: PngMetadata; readonly checksum: string } {
  if (mimeType !== "image/png") {
    throw new CharacterVisualUnsupportedFileTypeError();
  }
  const parsed = parsePng(buffer);
  if (typeof parsed === "string" || !parsed.hasAlpha) {
    throw new CharacterVisualInvalidPngError();
  }
  return {
    metadata: parsed,
    checksum: createHash("sha256").update(buffer).digest("hex")
  };
}

function validateLegacyVariant(variant: LegacyCharacterVisualVariant): void {
  if (!idSchema.safeParse(variant.characterId).success) {
    throw new CharacterVisualValidationError(
      `unsafe visualId in legacy catalog: ${variant.characterId}`
    );
  }
  if (!idSchema.safeParse(variant.variantId).success) {
    throw new CharacterVisualValidationError(
      `unsafe variantId in legacy catalog: ${variant.variantId}`
    );
  }
  const expectedKeys = expectedCharacterVariantFileKeys(variant.renderType);
  const keys = variant.files.map((file) => file.key);
  if (
    keys.length !== expectedKeys.length ||
    new Set(keys).size !== keys.length ||
    expectedKeys.some((key) => !keys.includes(key))
  ) {
    throw new CharacterVisualValidationError(
      `legacy variant ${variant.variantId} does not contain the required file slots`
    );
  }
  for (const file of variant.files) {
    if (!isSafeRelativePath(file.key) || !isSafeRelativePath(file.sourceFile)) {
      throw new CharacterVisualValidationError(
        `legacy variant ${variant.variantId} contains an unsafe file path`
      );
    }
  }
}

async function prepareSeedCatalog(
  sourceRoot: string,
  catalog: readonly LegacyCharacterVisualVariant[],
  names: Readonly<Record<string, string>>,
  descriptions: Readonly<Record<string, string>>
): Promise<readonly PreparedSeedVisual[]> {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const visualGroups = new Map<string, LegacyCharacterVisualVariant[]>();
  const variantIds = new Set<string>();
  const sourceFiles = new Set<string>();
  for (const variant of catalog) {
    validateLegacyVariant(variant);
    if (variantIds.has(variant.variantId)) {
      throw new CharacterVisualValidationError(
        `variantId is duplicated in legacy catalog: ${variant.variantId}`
      );
    }
    variantIds.add(variant.variantId);
    for (const file of variant.files) {
      if (sourceFiles.has(file.sourceFile)) {
        throw new CharacterVisualValidationError(
          `source file is duplicated in legacy catalog: ${file.sourceFile}`
        );
      }
      sourceFiles.add(file.sourceFile);
    }
    const variants = visualGroups.get(variant.characterId) ?? [];
    variants.push(variant);
    visualGroups.set(variant.characterId, variants);
  }

  const preparedVisuals: PreparedSeedVisual[] = [];
  for (const [visualId, variants] of [...visualGroups.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    const preparedVariants: PreparedSeedVariant[] = [];
    let baseWidth: number | undefined;
    let baseHeight: number | undefined;
    for (const variant of variants.sort((left, right) =>
      left.variantId.localeCompare(right.variantId)
    )) {
      const files: PreparedSeedFile[] = [];

      for (const file of variant.files) {
        const sourcePath = resolveInside(resolvedSourceRoot, file.sourceFile);
        const buffer = await readRegularFile(sourcePath);
        const inspected = inspectPng(buffer, sourcePath);
        if (baseWidth === undefined) {
          baseWidth = inspected.metadata.width;
          baseHeight = inspected.metadata.height;
        }
        if (
          inspected.metadata.width !== baseWidth ||
          inspected.metadata.height !== baseHeight
        ) {
          throw new CharacterVisualValidationError(
            `legacy visual ${visualId} has inconsistent canvas sizes`
          );
        }
        files.push({
          variantId: variant.variantId,
          fileKey: file.key,
          sourcePath,
          libraryPath: `library/character-visuals/${visualId}/${variant.variantId}/${file.key}.png`,
          mimeType: "image/png",
          checksum: inspected.checksum,
          sizeBytes: buffer.length,
          width: inspected.metadata.width,
          height: inspected.metadata.height
        });
      }

      preparedVariants.push({
        visualId,
        variantId: variant.variantId,
        label: variant.label,
        renderType: variant.renderType,
        status: "active",
        tags: [...variant.tags],
        files
      });
    }

    if (baseWidth === undefined || baseHeight === undefined) {
      throw new CharacterVisualValidationError(
        `legacy visual ${visualId} has no files`
      );
    }
    preparedVisuals.push({
      visualId,
      name: names[visualId] ?? visualId,
      description:
        descriptions[visualId] ??
        "Migrated from the legacy character visual catalog.",
      status: "active",
      baseWidth,
      baseHeight,
      variants: preparedVariants
    });
  }

  return preparedVisuals;
}

function fileInsert(
  file: PreparedSeedFile,
  timestamp: string
): CharacterVisualFileInsert {
  return {
    variantId: file.variantId,
    fileKey: file.fileKey,
    libraryPath: file.libraryPath,
    mimeType: file.mimeType,
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function uploadedFileInsert(
  variantId: string,
  file: PreparedUploadedFile,
  timestamp: string
): CharacterVisualFileInsert {
  return {
    variantId,
    fileKey: file.key,
    libraryPath: file.libraryPath,
    mimeType: "image/png",
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function variantInsert(
  variant: PreparedSeedVariant,
  timestamp: string
): CharacterVariantInsert {
  return {
    variantId: variant.variantId,
    visualId: variant.visualId,
    label: variant.label,
    renderType: variant.renderType,
    status: variant.status,
    tags: variant.tags,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function visualInsert(
  visual: PreparedSeedVisual,
  timestamp: string
): CharacterVisualInsert {
  return {
    visualId: visual.visualId,
    name: visual.name,
    description: visual.description,
    status: visual.status,
    baseWidth: visual.baseWidth,
    baseHeight: visual.baseHeight,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function installSeedFiles(
  workspaceRoot: string,
  visuals: readonly PreparedSeedVisual[]
): Promise<{ readonly createdPaths: readonly string[] }> {
  await assertNoSymlinkComponents(workspaceRoot, "library/staging");
  const stagingRoot = path.join(
    path.resolve(workspaceRoot),
    "library",
    "staging",
    `character-visual-seed-${randomUUID().toLowerCase()}`
  );
  const createdPaths: string[] = [];
  await mkdir(stagingRoot, { recursive: true });

  try {
    for (const visual of visuals) {
      for (const variant of visual.variants) {
        for (const file of variant.files) {
          const targetPath = resolveInside(workspaceRoot, file.libraryPath);
          await assertNoSymlinkComponents(workspaceRoot, file.libraryPath);
          const stagePath = path.join(
            stagingRoot,
            `${file.variantId}-${file.fileKey}.png`
          );
          await copyFile(file.sourcePath, stagePath);

          let targetExists = false;
          try {
            const targetStats = await lstat(targetPath);
            targetExists = true;
            if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
              throw new CharacterVisualSeedConflictError(
                `managed character visual path is not a regular file: ${file.libraryPath}`
              );
            }
            const existingBuffer = await readFile(targetPath);
            const existingChecksum = createHash("sha256")
              .update(existingBuffer)
              .digest("hex");
            if (existingChecksum !== file.checksum) {
              throw new CharacterVisualSeedConflictError(
                `managed character visual file differs from the seed source: ${file.libraryPath}`
              );
            }
          } catch (error) {
            if (!isMissingPath(error)) {
              throw error;
            }
          }

          if (targetExists) {
            continue;
          }

          await mkdir(path.dirname(targetPath), { recursive: true });
          await rename(stagePath, targetPath);
          createdPaths.push(targetPath);
        }
      }
    }
    return { createdPaths };
  } catch (error) {
    await Promise.all(
      createdPaths.map((filePath) => rm(filePath, { force: true }))
    );
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function preparedSeedSnapshot(
  visuals: readonly PreparedSeedVisual[],
  timestamp: string
): CharacterVisualCatalogSnapshot {
  return visuals.map((visual) => ({
    visualId: visual.visualId,
    name: visual.name,
    description: visual.description,
    status: visual.status,
    baseWidth: visual.baseWidth,
    baseHeight: visual.baseHeight,
    variants: visual.variants.map((variant) => ({
      variantId: variant.variantId,
      label: variant.label,
      renderType: variant.renderType,
      status: variant.status,
      tags: [...variant.tags],
      files: variant.files.map((file) => ({
        key: file.fileKey,
        libraryPath: file.libraryPath,
        mimeType: file.mimeType,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
        width: file.width,
        height: file.height
      }))
    })),
    createdAt: timestamp,
    updatedAt: timestamp
  }));
}

export class CharacterVisualCatalogService {
  private readonly repository: CharacterVisualRepository;
  private readonly workspaceRoot: string;
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly onOrphanDetected:
    ((paths: readonly string[], cause: unknown) => void) | undefined;

  constructor(options: CharacterVisualCatalogServiceOptions) {
    this.repository = options.repository;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.now = options.now ?? (() => new Date());
    this.onOrphanDetected = options.onOrphanDetected;
  }

  list(): CharacterVisualCatalogSnapshot {
    return this.repository.list();
  }

  async verifyFiles(
    snapshot: CharacterVisualCatalogSnapshot = this.repository.list()
  ): Promise<CharacterVisualCatalogSnapshot> {
    for (const visual of snapshot) {
      for (const variant of visual.variants) {
        for (const file of variant.files) {
          const managedPath = resolveInside(
            this.workspaceRoot,
            file.libraryPath
          );
          await assertNoSymlinkComponents(this.workspaceRoot, file.libraryPath);
          const buffer = await readRegularFile(managedPath);
          const inspected = inspectPng(buffer, managedPath);
          const checksum = inspected.checksum;
          if (
            buffer.length !== file.sizeBytes ||
            checksum !== file.checksum ||
            inspected.metadata.width !== file.width ||
            inspected.metadata.height !== file.height
          ) {
            throw new CharacterVisualValidationError(
              `managed character visual metadata does not match ${file.libraryPath}`
            );
          }
        }
      }
    }
    return snapshot;
  }

  get(visualId: string): CharacterVisualSet | undefined {
    return this.repository.findById(visualId);
  }

  async stageUpload(file: {
    readonly stream: Readable;
    readonly mimeType?: string;
    readonly filename?: string;
  }): Promise<CharacterVisualStagedUpload> {
    await assertNoSymlinkComponents(this.workspaceRoot, "library/staging");
    const stagingRelativePath = `library/staging/character-visual-upload-${randomUUID().toLowerCase()}`;
    const fileRelativePath = `${stagingRelativePath}/upload.bin`;
    const stagingRoot = resolveInside(this.workspaceRoot, stagingRelativePath);
    const filePath = resolveInside(this.workspaceRoot, fileRelativePath);
    await mkdir(stagingRoot, { recursive: true });

    try {
      await pipeline(
        file.stream,
        createUploadSizeLimiter(),
        createWriteStream(filePath, { flags: "wx" })
      );
      const fileStats = await stat(filePath);
      if (
        isTruncated(file.stream) ||
        fileStats.size > CHARACTER_VISUAL_MAX_FILE_BYTES
      ) {
        throw new CharacterVisualFileTooLargeError();
      }
      return {
        stagingRelativePath,
        fileRelativePath,
        sizeBytes: fileStats.size
      };
    } catch (error) {
      await this.cleanupStagingRoots([stagingRelativePath], error);
      if (
        error instanceof CharacterVisualApiError ||
        isMultipartUploadError(error)
      ) {
        throw error;
      }
      throw new CharacterVisualStorageError(error);
    }
  }

  async discardStaged(staged: CharacterVisualStagedUpload): Promise<void> {
    await this.cleanupStagingRoots([staged.stagingRelativePath], staged);
  }

  async findOrphanedFiles(): Promise<readonly string[]> {
    const referencedPaths = new Set(
      this.repository
        .list()
        .flatMap((visual) =>
          visual.variants.flatMap((variant) =>
            variant.files.map((file) => file.libraryPath)
          )
        )
    );
    const managedFiles = await collectFiles(
      resolveInside(this.workspaceRoot, "library/character-visuals"),
      "library/character-visuals"
    );
    const stagingFiles = (
      await collectFiles(
        resolveInside(this.workspaceRoot, "library/staging"),
        "library/staging"
      )
    ).filter((file) => file.startsWith("library/staging/character-visual-"));
    return [
      ...managedFiles.filter((file) => !referencedPaths.has(file)),
      ...stagingFiles
    ].sort();
  }

  async readManagedFile(
    visualId: string,
    variantId: string,
    fileKey: string
  ): Promise<CharacterVisualManagedFile | undefined> {
    const visual = this.repository.findById(visualId);
    const variant = visual?.variants.find(
      (candidate) => candidate.variantId === variantId
    );
    const file = variant?.files.find((candidate) => candidate.key === fileKey);
    if (file === undefined) {
      return undefined;
    }

    const managedPath = resolveInside(this.workspaceRoot, file.libraryPath);
    await assertNoSymlinkComponents(this.workspaceRoot, file.libraryPath);
    const content = await readRegularFile(managedPath);
    return { content, mimeType: file.mimeType };
  }

  private requireVisual(visualId: string): CharacterVisualSet {
    const visual = this.get(visualId);
    if (visual === undefined) {
      throw new CharacterVisualNotFoundError();
    }
    return visual;
  }

  private requireVariant(
    visualId: string,
    variantId: string
  ): {
    readonly visual: CharacterVisualSet;
    readonly variant: CharacterVariant;
  } {
    const visual = this.requireVisual(visualId);
    const variant = visual.variants.find(
      (candidate) => candidate.variantId === variantId
    );
    if (variant === undefined) {
      throw new CharacterVariantNotFoundError();
    }
    return { visual, variant };
  }

  private async cleanupPathsBestEffort(
    paths: readonly string[],
    cause: unknown,
    recursive = false
  ): Promise<void> {
    const failedPaths: string[] = [];
    for (const targetPath of paths) {
      try {
        await rm(targetPath, { force: true, recursive });
      } catch {
        failedPaths.push(
          path
            .relative(this.workspaceRoot, targetPath)
            .replaceAll(path.sep, "/")
        );
      }
    }
    if (failedPaths.length > 0) {
      this.reportOrphans(failedPaths, cause);
    }
  }

  private reportOrphans(paths: readonly string[], cause: unknown): void {
    try {
      this.onOrphanDetected?.(paths, cause);
    } catch {
      // Diagnostics must never change the result of the storage operation.
    }
  }

  private async cleanupStagingRoots(
    stagingRoots: readonly string[],
    cause: unknown
  ): Promise<void> {
    await this.cleanupPathsBestEffort(
      stagingRoots.map((relativePath) =>
        resolveInside(this.workspaceRoot, relativePath)
      ),
      cause,
      true
    );
  }

  private async stageInlineContent(
    key: string,
    content: Buffer
  ): Promise<{
    readonly stagingRelativePath: string;
    readonly stagePath: string;
  }> {
    if (content.length > CHARACTER_VISUAL_MAX_FILE_BYTES) {
      throw new CharacterVisualFileTooLargeError();
    }
    await assertNoSymlinkComponents(this.workspaceRoot, "library/staging");
    const stagingRelativePath = `library/staging/character-visual-upload-${randomUUID().toLowerCase()}`;
    const stagingRoot = resolveInside(this.workspaceRoot, stagingRelativePath);
    await mkdir(stagingRoot, { recursive: true });
    const stagePath = path.join(stagingRoot, `${key}.upload`);
    try {
      await writeFileNode(stagePath, content, { flag: "wx" });
      return { stagingRelativePath, stagePath };
    } catch (error) {
      await this.cleanupStagingRoots([stagingRelativePath], error);
      throw new CharacterVisualStorageError(error);
    }
  }

  private async stageVariantFiles(
    visual: CharacterVisualSet,
    variantId: string,
    input: CharacterVisualVariantInput,
    excludedVariantId?: string
  ): Promise<PreparedVariantFiles> {
    const expectedKeys = expectedCharacterVariantFileKeys(input.renderType);
    const filesByKey = new Map<string, CharacterVisualUploadFile>();
    for (const file of input.files) {
      if (filesByKey.has(file.key)) {
        throw new CharacterVisualMissingSlotError();
      }
      filesByKey.set(file.key, file);
    }
    if (
      input.files.length !== expectedKeys.length ||
      expectedKeys.some((key) => !filesByKey.has(key)) ||
      [...filesByKey.keys()].some((key) => !expectedKeys.includes(key))
    ) {
      throw new CharacterVisualMissingSlotError();
    }

    const stagingRoots = new Set<string>();
    const generationId = randomUUID().toLowerCase();
    try {
      const prepared: PreparedUploadedFile[] = [];
      for (const key of expectedKeys) {
        const upload = filesByKey.get(key);
        if (upload === undefined) {
          throw new CharacterVisualMissingSlotError();
        }

        let stagePath: string;
        if (upload.staged !== undefined) {
          if (
            !upload.staged.fileRelativePath.startsWith(
              `${upload.staged.stagingRelativePath}/`
            )
          ) {
            throw new CharacterVisualUnsafePathError();
          }
          await assertNoSymlinkComponents(
            this.workspaceRoot,
            upload.staged.stagingRelativePath
          );
          await assertNoSymlinkComponents(
            this.workspaceRoot,
            upload.staged.fileRelativePath
          );
          stagingRoots.add(upload.staged.stagingRelativePath);
          stagePath = resolveInside(
            this.workspaceRoot,
            upload.staged.fileRelativePath
          );
        } else if (upload.content !== undefined) {
          const inline = await this.stageInlineContent(key, upload.content);
          stagingRoots.add(inline.stagingRelativePath);
          stagePath = inline.stagePath;
        } else {
          throw new CharacterVisualStorageError(
            new Error("character visual upload has no staged content")
          );
        }

        let buffer: Buffer;
        try {
          buffer = await readFile(stagePath);
        } catch (error) {
          throw new CharacterVisualStorageError(error);
        }
        const inspected = inspectUploadedPng(buffer, upload.mimeType);
        const libraryPath =
          `library/character-visuals/${visual.visualId}/${variantId}/${generationId}-${key}.png` as CharacterVisualFile["libraryPath"];
        prepared.push({
          key: key as CharacterVisualFile["key"],
          stagePath,
          targetPath: resolveInside(this.workspaceRoot, libraryPath),
          libraryPath,
          checksum: inspected.checksum,
          sizeBytes: buffer.length,
          width: inspected.metadata.width,
          height: inspected.metadata.height
        });
      }

      const first = prepared[0];
      if (
        first === undefined ||
        prepared.some(
          (file) => file.width !== first.width || file.height !== first.height
        )
      ) {
        throw new CharacterVisualCanvasSizeMismatchError();
      }
      if (
        visual.baseWidth !== null &&
        (first.width !== visual.baseWidth || first.height !== visual.baseHeight)
      ) {
        throw new CharacterVisualCanvasSizeMismatchError();
      }

      const existingFiles = this.repository
        .list()
        .flatMap((candidateVisual) =>
          candidateVisual.variants
            .filter((variant) => variant.variantId !== excludedVariantId)
            .flatMap((variant) => variant.files)
        );
      const existingChecksums = new Set(
        existingFiles.map((file) => file.checksum)
      );
      const checksums = new Set<string>();
      for (const file of prepared) {
        if (
          checksums.has(file.checksum) ||
          existingChecksums.has(file.checksum)
        ) {
          throw new CharacterVisualConflictError(
            "The uploaded character visual file is already registered."
          );
        }
        checksums.add(file.checksum);
      }

      return { stagingRoots: [...stagingRoots], files: prepared };
    } catch (error) {
      await this.cleanupStagingRoots([...stagingRoots], error);
      throw error;
    }
  }

  private async rollbackPromotion(
    installedPaths: readonly string[],
    cause: unknown
  ): Promise<void> {
    await this.cleanupPathsBestEffort(installedPaths, cause);
  }

  private async promoteFiles(
    files: readonly PreparedUploadedFile[]
  ): Promise<{ readonly installedPaths: readonly string[] }> {
    const installedPaths: string[] = [];
    try {
      for (const file of files) {
        await assertNoSymlinkComponents(
          this.workspaceRoot,
          path
            .relative(this.workspaceRoot, file.targetPath)
            .replaceAll(path.sep, "/")
        );
        try {
          await lstat(file.targetPath);
          throw new CharacterVisualConflictError(
            "The managed character visual path is already registered."
          );
        } catch (error) {
          if (!isMissingPath(error)) {
            throw error;
          }
        }
        await mkdir(path.dirname(file.targetPath), { recursive: true });
        await rename(file.stagePath, file.targetPath);
        installedPaths.push(file.targetPath);
      }
      return { installedPaths };
    } catch (error) {
      await this.rollbackPromotion(installedPaths, error);
      if (error instanceof CharacterVisualApiError) {
        throw error;
      }
      throw new CharacterVisualStorageError(error);
    }
  }

  private async commitVariant(
    visual: CharacterVisualSet,
    variantId: string,
    input: CharacterVisualVariantInput,
    staged: PreparedVariantFiles,
    existingVariant: CharacterVariant | undefined
  ): Promise<CharacterVisualSet> {
    const timestamp = toIsoDate(this.now);
    const status = existingVariant?.status ?? "active";
    const candidateVariant = {
      variantId,
      label: input.label.trim(),
      renderType: input.renderType,
      status,
      tags: [...input.tags],
      files: staged.files.map((file) => ({
        key: file.key,
        libraryPath: file.libraryPath,
        mimeType: "image/png" as const,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
        width: file.width,
        height: file.height
      }))
    } satisfies CharacterVariant;
    const baseWidth = visual.baseWidth ?? staged.files[0]?.width ?? null;
    const baseHeight = visual.baseHeight ?? staged.files[0]?.height ?? null;
    let obsoletePaths: readonly string[];
    try {
      characterVisualSetSchema.parse({
        ...visual,
        baseWidth,
        baseHeight,
        variants:
          existingVariant === undefined
            ? [...visual.variants, candidateVariant]
            : visual.variants.map((variant) =>
                variant.variantId === variantId ? candidateVariant : variant
              ),
        updatedAt: timestamp
      });
      obsoletePaths =
        existingVariant?.files.map((file) =>
          resolveInside(this.workspaceRoot, file.libraryPath)
        ) ?? [];
    } catch (error) {
      await this.cleanupStagingRoots(staged.stagingRoots, error);
      throw error;
    }

    let promotion: { readonly installedPaths: readonly string[] } | undefined;
    try {
      promotion = await this.promoteFiles(staged.files);
      this.repository.transaction((transaction) => {
        const currentVisual = transaction.findById(visual.visualId);
        if (currentVisual === undefined) {
          throw new CharacterVisualNotFoundError();
        }
        const firstStagedFile = staged.files[0];
        if (firstStagedFile === undefined) {
          throw new CharacterVisualMissingSlotError();
        }
        if (
          currentVisual.baseWidth === null ||
          currentVisual.baseHeight === null
        ) {
          transaction.updateBaseCanvas(
            visual.visualId,
            firstStagedFile.width,
            firstStagedFile.height,
            timestamp
          );
        } else if (
          staged.files.some(
            (file) =>
              file.width !== currentVisual.baseWidth ||
              file.height !== currentVisual.baseHeight
          )
        ) {
          throw new CharacterVisualCanvasSizeMismatchError();
        }
        transaction.touchVisual(visual.visualId, timestamp);
        if (existingVariant === undefined) {
          transaction.insertVariant({
            variantId,
            visualId: visual.visualId,
            label: candidateVariant.label,
            renderType: candidateVariant.renderType,
            status: candidateVariant.status,
            tags: candidateVariant.tags,
            createdAt: timestamp,
            updatedAt: timestamp
          });
        } else {
          transaction.updateVariant(variantId, {
            label: candidateVariant.label,
            renderType: candidateVariant.renderType,
            tags: candidateVariant.tags,
            updatedAt: timestamp
          });
          transaction.replaceFiles(
            variantId,
            staged.files.map((file) =>
              uploadedFileInsert(variantId, file, timestamp)
            )
          );
        }
        if (existingVariant === undefined) {
          for (const file of staged.files) {
            transaction.insertFile(
              uploadedFileInsert(variantId, file, timestamp)
            );
          }
        }
      });
    } catch (error) {
      if (promotion !== undefined) {
        await this.rollbackPromotion(promotion.installedPaths, error);
      }
      throw error;
    } finally {
      await this.cleanupStagingRoots(
        staged.stagingRoots,
        new Error("variant upload completed")
      );
    }

    if (obsoletePaths.length > 0) {
      await this.cleanupPathsBestEffort(
        obsoletePaths,
        new Error("replaced character visual files are no longer referenced")
      );
    }

    return this.requireVisual(visual.visualId);
  }

  async createVariant(
    visualId: string,
    input: CharacterVisualVariantInput
  ): Promise<CharacterVisualSet> {
    const visual = this.requireVisual(visualId);
    const variantId = idSchema.parse(this.createId());
    const staged = await this.stageVariantFiles(visual, variantId, input);
    return this.commitVariant(visual, variantId, input, staged, undefined);
  }

  async updateVariant(
    visualId: string,
    variantId: string,
    input: CharacterVisualVariantInput
  ): Promise<CharacterVisualSet> {
    const { visual, variant } = this.requireVariant(visualId, variantId);
    const staged = await this.stageVariantFiles(
      visual,
      variantId,
      input,
      variantId
    );
    return this.commitVariant(visual, variantId, input, staged, variant);
  }

  update(
    visualId: string,
    input: CharacterVisualUpdateInput
  ): CharacterVisualSet {
    const visual = this.requireVisual(visualId);
    const timestamp = toIsoDate(this.now);
    const next = characterVisualSetSchema.parse({
      ...visual,
      name: input.name.trim(),
      description: input.description.trim(),
      status: input.status,
      updatedAt: timestamp
    });
    this.repository.updateVisual(visualId, {
      name: next.name,
      description: next.description,
      status: next.status,
      updatedAt: next.updatedAt
    });
    return this.requireVisual(visualId);
  }

  private setVariantStatus(
    visualId: string,
    variantId: string,
    status: CharacterVariantStatus
  ): CharacterVisualSet {
    const { visual, variant } = this.requireVariant(visualId, variantId);
    const timestamp = toIsoDate(this.now);
    this.repository.transaction((transaction) => {
      transaction.updateVariantStatus(variant.variantId, status, timestamp);
      transaction.touchVisual(visual.visualId, timestamp);
    });
    return this.requireVisual(visualId);
  }

  deactivateVariant(visualId: string, variantId: string): CharacterVisualSet {
    return this.setVariantStatus(visualId, variantId, "inactive");
  }

  activateVariant(visualId: string, variantId: string): CharacterVisualSet {
    return this.setVariantStatus(visualId, variantId, "active");
  }

  create(input: CharacterVisualCreateInput): CharacterVisualSet {
    const timestamp = toIsoDate(this.now);
    const visual = characterVisualSetSchema.parse({
      visualId: this.createId(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      status: input.status ?? "active",
      baseWidth: null,
      baseHeight: null,
      variants: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return this.repository.insertVisual(visual);
  }

  async seedLegacyCatalog(options: {
    readonly sourceRoot: string;
    readonly catalog: readonly LegacyCharacterVisualVariant[];
    readonly names?: Readonly<Record<string, string>>;
    readonly descriptions?: Readonly<Record<string, string>>;
  }): Promise<CharacterVisualCatalogSnapshot> {
    const existingCatalog = this.repository.list();
    const existingVisualIds = new Set(
      existingCatalog.map((visual) => visual.visualId)
    );
    const catalogToSeed = options.catalog.filter(
      (variant) => !existingVisualIds.has(variant.characterId)
    );
    if (catalogToSeed.length === 0) {
      return existingCatalog;
    }

    const prepared = await prepareSeedCatalog(
      options.sourceRoot,
      catalogToSeed,
      options.names ?? {},
      options.descriptions ?? {}
    );
    const { createdPaths } = await installSeedFiles(
      this.workspaceRoot,
      prepared
    );
    const timestamp = toIsoDate(this.now);

    try {
      const preparedSnapshot = preparedSeedSnapshot(prepared, timestamp);
      assertCharacterVisualCatalog(preparedSnapshot);
      await this.verifyFiles(preparedSnapshot);
      const finalSnapshot = this.repository.transaction((transaction) => {
        for (const visual of prepared) {
          transaction.insertVisual(visualInsert(visual, timestamp));
          for (const variant of visual.variants) {
            transaction.insertVariant(variantInsert(variant, timestamp));
            for (const file of variant.files) {
              transaction.insertFile(fileInsert(file, timestamp));
            }
          }
        }

        const snapshot = transaction.list();
        assertCharacterVisualCatalog(snapshot);
        return snapshot;
      });
      return finalSnapshot;
    } catch (error) {
      await Promise.all(
        createdPaths.map((filePath) => rm(filePath, { force: true }))
      );
      throw error;
    }
  }
}
