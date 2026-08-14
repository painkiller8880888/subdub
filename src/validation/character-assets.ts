import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import {
  CHARACTER_CANVAS_SIZE,
  characterVariantCatalog,
  type CharacterVariant,
  type CharacterVariantCatalog,
  type CharacterVariantFile
} from "../assets/character-asset-manifest.js";
import { parsePng, type PngMetadata } from "./png.js";
const SINGLE_IMAGE_FILE_KEY = "single";
const MOUTH_PAIR_FILE_KEYS = ["closed", "open"] as const;

export type CharacterAssetIssue = {
  readonly variantId: string;
  readonly characterId: string;
  readonly meaning: string;
  readonly expectedSourceFile: string;
  readonly expectedDestinationPath: string;
  readonly message: string;
};

export type CharacterAssetInspection = CharacterVariantFile & {
  readonly variantId: string;
  readonly characterId: string;
  readonly source: PngMetadata | null;
  readonly destination: PngMetadata | null;
};

export type CharacterAssetValidationResult = {
  readonly valid: boolean;
  readonly canvas: typeof CHARACTER_CANVAS_SIZE;
  readonly files: readonly CharacterAssetInspection[];
  readonly issues: readonly CharacterAssetIssue[];
};

export type CharacterAssetValidationOptions = {
  readonly sourceRoot: string;
  readonly publicRoot: string;
  readonly catalog?: CharacterVariantCatalog;
};

function issueForFile(
  variant: CharacterVariant,
  file: CharacterVariantFile,
  message: string
): CharacterAssetIssue {
  return {
    variantId: variant.variantId,
    characterId: variant.characterId,
    meaning: file.key,
    expectedSourceFile: file.sourceFile,
    expectedDestinationPath: file.destinationPath,
    message
  };
}

function issueForVariant(
  variant: CharacterVariant,
  message: string,
  meaning = "variant"
): CharacterAssetIssue {
  const firstFile = variant.files[0];
  return {
    variantId: variant.variantId,
    characterId: variant.characterId,
    meaning,
    expectedSourceFile: firstFile?.sourceFile ?? "not assigned",
    expectedDestinationPath: firstFile?.destinationPath ?? "not assigned",
    message
  };
}

async function readAsset(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files;
}

function publicRelativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isSafePosixRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value
      .split("/")
      .some(
        (segment) => segment === "" || segment === "." || segment === ".."
      ) &&
    !value.includes("\\")
  );
}

async function addUnexpectedSourceIssues(
  sourceRoot: string,
  catalog: CharacterVariantCatalog,
  issues: CharacterAssetIssue[]
): Promise<void> {
  const expected = new Set(
    catalog.flatMap((variant) => variant.files.map((file) => file.sourceFile))
  );
  const entries = await readdir(sourceRoot, { withFileTypes: true }).catch(
    () => []
  );
  for (const entry of entries) {
    if (
      entry.isFile() &&
      /^char\d+.*\.png$/u.test(entry.name) &&
      !expected.has(entry.name)
    ) {
      issues.push({
        variantId: "unregistered",
        characterId: entry.name.startsWith("char03")
          ? "character-mentor"
          : entry.name.startsWith("char04")
            ? "character-learner"
            : "unregistered",
        meaning: "unexpected",
        expectedSourceFile: entry.name,
        expectedDestinationPath: "not assigned",
        message: `unexpected character asset filename: ${entry.name}`
      });
    }
  }
}

async function addUnexpectedDestinationIssues(
  publicRoot: string,
  catalog: CharacterVariantCatalog,
  issues: CharacterAssetIssue[]
): Promise<void> {
  const expected = new Set(
    catalog.flatMap((variant) =>
      variant.files.map((file) => file.destinationPath)
    )
  );
  const files = await listFiles(
    path.join(publicRoot, "shared-assets", "characters")
  );
  for (const file of files) {
    const relativePath = publicRelativePath(publicRoot, file);
    if (!expected.has(relativePath)) {
      const characterId = relativePath.includes("/character-mentor/")
        ? "character-mentor"
        : relativePath.includes("/character-learner/")
          ? "character-learner"
          : "unknown";
      issues.push({
        variantId: "unregistered",
        characterId,
        meaning: "unexpected",
        expectedSourceFile: "not assigned",
        expectedDestinationPath: relativePath,
        message: `unexpected canonical character asset path: ${relativePath}`
      });
    }
  }
}

function checkCatalog(
  catalog: CharacterVariantCatalog,
  issues: CharacterAssetIssue[]
): void {
  const variantIds = new Set<string>();
  const sourceAssignments = new Map<string, CharacterVariantFile>();
  const destinationAssignments = new Map<string, CharacterVariantFile>();

  for (const variant of catalog) {
    if (variantIds.has(variant.variantId)) {
      issues.push(issueForVariant(variant, "variantId is duplicated"));
    }
    variantIds.add(variant.variantId);

    if (!isSafePosixRelativePath(variant.variantId)) {
      issues.push(issueForVariant(variant, "variantId is not safe"));
    }
    for (const file of variant.files) {
      const expectedPrefix = `shared-assets/characters/${variant.characterId}/`;
      if (!file.destinationPath.startsWith(expectedPrefix)) {
        issues.push(
          issueForFile(
            variant,
            file,
            `destination path must be under ${expectedPrefix}`
          )
        );
      }
      if (!file.destinationPath.endsWith(".png")) {
        issues.push(
          issueForFile(
            variant,
            file,
            "canonical character asset destination must end with .png"
          )
        );
      }
      if (!isSafePosixRelativePath(file.sourceFile)) {
        issues.push(
          issueForFile(variant, file, "source file path is not safe")
        );
      }
      if (!isSafePosixRelativePath(file.destinationPath)) {
        issues.push(
          issueForFile(variant, file, "destination path is not safe")
        );
      }

      const previousSource = sourceAssignments.get(file.sourceFile);
      if (previousSource !== undefined) {
        issues.push(
          issueForFile(
            variant,
            file,
            `source file is registered more than once (already used by ${previousSource.key})`
          )
        );
      } else {
        sourceAssignments.set(file.sourceFile, file);
      }

      const previousDestination = destinationAssignments.get(
        file.destinationPath
      );
      if (previousDestination !== undefined) {
        issues.push(
          issueForFile(
            variant,
            file,
            `destination path is registered more than once (already used by ${previousDestination.key})`
          )
        );
      } else {
        destinationAssignments.set(file.destinationPath, file);
      }
    }

    const expectedKeys =
      variant.renderType === "single-image"
        ? [SINGLE_IMAGE_FILE_KEY]
        : variant.renderType === "mouth-pair"
          ? MOUTH_PAIR_FILE_KEYS
          : [];
    const counts = new Map<string, number>();
    for (const file of variant.files) {
      counts.set(file.key, (counts.get(file.key) ?? 0) + 1);
    }
    for (const key of expectedKeys) {
      const count = counts.get(key) ?? 0;
      if (count === 0) {
        issues.push(issueForVariant(variant, `${key} file is missing`, key));
      } else if (count > 1) {
        issues.push(issueForVariant(variant, `${key} file is duplicated`, key));
      }
    }
    for (const key of counts.keys()) {
      if (!expectedKeys.includes(key as never)) {
        issues.push(
          issueForVariant(variant, `unexpected file key: ${key}`, key)
        );
      }
    }
  }
}

export async function validateCharacterAssets(
  options: CharacterAssetValidationOptions
): Promise<CharacterAssetValidationResult> {
  const catalog = options.catalog ?? characterVariantCatalog;
  const issues: CharacterAssetIssue[] = [];
  const files: CharacterAssetInspection[] = [];
  const parsedByVariantAndKey = new Map<string, PngMetadata>();

  checkCatalog(catalog, issues);
  await addUnexpectedSourceIssues(options.sourceRoot, catalog, issues);
  await addUnexpectedDestinationIssues(options.publicRoot, catalog, issues);

  for (const variant of catalog) {
    for (const file of variant.files) {
      const sourcePath = path.join(options.sourceRoot, file.sourceFile);
      const destinationPath = path.join(
        options.publicRoot,
        file.destinationPath
      );
      const sourceBuffer = await readAsset(sourcePath);
      const destinationBuffer = await readAsset(destinationPath);
      const source = sourceBuffer === null ? null : parsePng(sourceBuffer);
      const destination =
        destinationBuffer === null ? null : parsePng(destinationBuffer);
      const sourceMetadata = typeof source === "string" ? null : source;
      const destinationMetadata =
        typeof destination === "string" ? null : destination;

      files.push({
        ...file,
        variantId: variant.variantId,
        characterId: variant.characterId,
        source: sourceMetadata,
        destination: destinationMetadata
      });

      if (sourceBuffer === null) {
        issues.push(
          issueForFile(variant, file, "source file is missing or unreadable")
        );
      } else if (typeof source === "string") {
        issues.push(
          issueForFile(variant, file, `source file is invalid: ${source}`)
        );
      }

      if (destinationBuffer === null) {
        issues.push(
          issueForFile(
            variant,
            file,
            "destination file is missing or unreadable"
          )
        );
      } else if (typeof destination === "string") {
        issues.push(
          issueForFile(
            variant,
            file,
            `destination file is invalid: ${destination}`
          )
        );
      }

      if (
        sourceBuffer !== null &&
        destinationBuffer !== null &&
        !sourceBuffer.equals(destinationBuffer)
      ) {
        issues.push(
          issueForFile(
            variant,
            file,
            "canonical asset is not an exact copy of the source"
          )
        );
      }

      for (const [label, metadata] of [
        ["source", sourceMetadata],
        ["destination", destinationMetadata]
      ] as const) {
        if (metadata === null) {
          continue;
        }
        if (
          metadata.width !== CHARACTER_CANVAS_SIZE.width ||
          metadata.height !== CHARACTER_CANVAS_SIZE.height
        ) {
          issues.push(
            issueForFile(
              variant,
              file,
              `${label} canvas must be ${CHARACTER_CANVAS_SIZE.width}x${CHARACTER_CANVAS_SIZE.height}, got ${metadata.width}x${metadata.height}`
            )
          );
        }
        if (!metadata.hasAlpha) {
          issues.push(
            issueForFile(
              variant,
              file,
              `${label} PNG does not declare alpha transparency`
            )
          );
        }
        parsedByVariantAndKey.set(
          `${variant.variantId}/${file.key}/${label}`,
          metadata
        );
      }
    }
  }

  for (const variant of catalog) {
    if (variant.renderType !== "mouth-pair") {
      continue;
    }
    for (const label of ["source", "destination"] as const) {
      const closed = parsedByVariantAndKey.get(
        `${variant.variantId}/closed/${label}`
      );
      const open = parsedByVariantAndKey.get(
        `${variant.variantId}/open/${label}`
      );
      if (
        closed !== undefined &&
        open !== undefined &&
        (closed.width !== open.width || closed.height !== open.height)
      ) {
        const openFile = variant.files.find((file) => file.key === "open");
        if (openFile !== undefined) {
          issues.push(
            issueForFile(
              variant,
              openFile,
              `${label} close/open canvas sizes do not match`
            )
          );
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    canvas: CHARACTER_CANVAS_SIZE,
    files,
    issues
  };
}

export function formatCharacterAssetIssues(
  issues: readonly CharacterAssetIssue[]
): string {
  return issues
    .map(
      (issue) =>
        `[${issue.characterId}/${issue.variantId}/${issue.meaning}] ${issue.message} (source: ${issue.expectedSourceFile}; destination: ${issue.expectedDestinationPath})`
    )
    .join("\n");
}
