import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import {
  CHARACTER_CANVAS_SIZE,
  characterAssetFiles,
  type CharacterAssetId
} from "../assets/character-asset-manifest.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type AssetFile = (typeof characterAssetFiles)[number];

export type PngMetadata = {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
  readonly hasAlpha: boolean;
};

export type CharacterAssetIssue = {
  readonly characterId: CharacterAssetId | string;
  readonly meaning: string;
  readonly expectedSourceFile: string;
  readonly expectedDestinationPath: string;
  readonly message: string;
};

export type CharacterAssetInspection = AssetFile & {
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
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePng(buffer: Buffer): PngMetadata | string {
  if (buffer.length < PNG_SIGNATURE.length) {
    return "file is empty or too small to be a PNG";
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return "PNG signature is invalid";
  }

  let offset = PNG_SIGNATURE.length;
  let ihdr: PngMetadata | null = null;
  let hasIdat = false;
  let hasTrns = false;
  let hasIend = false;

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      return "PNG chunk header is truncated";
    }

    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const chunkEnd = offset + length;
    if (chunkEnd + 4 > buffer.length) {
      return `PNG ${type || "unknown"} chunk is truncated`;
    }

    const data = buffer.subarray(offset, chunkEnd);
    const expectedCrc = buffer.readUInt32BE(chunkEnd);
    const actualCrc = crc32(buffer.subarray(offset - 4, chunkEnd));
    if (expectedCrc !== actualCrc) {
      return `PNG ${type || "unknown"} chunk has an invalid CRC`;
    }
    offset = chunkEnd + 4;

    if (ihdr === null && type !== "IHDR") {
      return "PNG must start with an IHDR chunk";
    }

    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) {
        return "PNG IHDR chunk is invalid";
      }
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        (colorType === 4 && [8, 16].includes(bitDepth)) ||
        (colorType === 6 && [8, 16].includes(bitDepth));
      if (
        width === 0 ||
        height === 0 ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        !validBitDepth ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] > 1
      ) {
        return "PNG IHDR values are invalid";
      }
      ihdr = {
        width,
        height,
        colorType,
        hasAlpha: colorType === 4 || colorType === 6
      };
    } else if (type === "IDAT") {
      hasIdat = true;
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "IEND") {
      if (length !== 0) {
        return "PNG IEND chunk is invalid";
      }
      hasIend = true;
      break;
    }
  }

  if (!hasIend || offset !== buffer.length) {
    return "PNG must end with an IEND chunk";
  }
  if (ihdr === null || !hasIdat) {
    return "PNG is missing required image data";
  }

  return {
    ...ihdr,
    hasAlpha: ihdr.hasAlpha || hasTrns
  };
}

function issueFor(asset: AssetFile, message: string): CharacterAssetIssue {
  return {
    characterId: asset.characterId,
    meaning: asset.meaning,
    expectedSourceFile: asset.sourceFile,
    expectedDestinationPath: asset.destinationPath,
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

function addUnexpectedSourceIssues(
  sourceRoot: string,
  issues: CharacterAssetIssue[]
): Promise<void> {
  return readdir(sourceRoot, { withFileTypes: true })
    .then((entries) => {
      const expected = new Set<string>(
        characterAssetFiles.map((asset) => asset.sourceFile)
      );
      for (const entry of entries) {
        if (
          entry.isFile() &&
          /^(char03|char04).*\.png$/u.test(entry.name) &&
          !expected.has(entry.name)
        ) {
          issues.push({
            characterId: entry.name.startsWith("char03")
              ? "character-mentor"
              : "character-learner",
            meaning: "unexpected",
            expectedSourceFile: entry.name,
            expectedDestinationPath: "not assigned",
            message: `unexpected character asset filename: ${entry.name}`
          });
        }
      }
    })
    .catch(() => undefined);
}

function addUnexpectedDestinationIssues(
  publicRoot: string,
  issues: CharacterAssetIssue[]
): Promise<void> {
  const expected = new Set<string>(
    characterAssetFiles.map((asset) => asset.destinationPath)
  );
  return listFiles(path.join(publicRoot, "shared-assets", "characters")).then(
    (files) => {
      for (const file of files) {
        const relativePath = publicRelativePath(publicRoot, file);
        if (!expected.has(relativePath)) {
          const characterId = relativePath.includes("/character-mentor/")
            ? "character-mentor"
            : relativePath.includes("/character-learner/")
              ? "character-learner"
              : "unknown";
          issues.push({
            characterId,
            meaning: "unexpected",
            expectedSourceFile: "not assigned",
            expectedDestinationPath: relativePath,
            message: `unexpected canonical character asset path: ${relativePath}`
          });
        }
      }
    }
  );
}

function checkDuplicateAssignments(issues: CharacterAssetIssue[]): void {
  const sourceFiles = new Set<string>();
  const destinationPaths = new Set<string>();
  for (const asset of characterAssetFiles) {
    if (sourceFiles.has(asset.sourceFile)) {
      issues.push(
        issueFor(asset, "source file is assigned to multiple meanings")
      );
    }
    if (destinationPaths.has(asset.destinationPath)) {
      issues.push(
        issueFor(asset, "destination path is assigned to multiple meanings")
      );
    }
    sourceFiles.add(asset.sourceFile);
    destinationPaths.add(asset.destinationPath);
  }
}

export async function validateCharacterAssets(
  options: CharacterAssetValidationOptions
): Promise<CharacterAssetValidationResult> {
  const issues: CharacterAssetIssue[] = [];
  const files: CharacterAssetInspection[] = [];
  const parsedByMeaning = new Map<string, PngMetadata>();

  checkDuplicateAssignments(issues);
  await addUnexpectedSourceIssues(options.sourceRoot, issues);
  await addUnexpectedDestinationIssues(options.publicRoot, issues);

  for (const asset of characterAssetFiles) {
    const sourcePath = path.join(options.sourceRoot, asset.sourceFile);
    const destinationPath = path.join(
      options.publicRoot,
      asset.destinationPath
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
      ...asset,
      source: sourceMetadata,
      destination: destinationMetadata
    });

    if (sourceBuffer === null || source === null) {
      issues.push(
        issueFor(
          asset,
          `expected source file is missing or unreadable: ${asset.sourceFile}`
        )
      );
    } else if (typeof source === "string") {
      issues.push(issueFor(asset, `source file is invalid: ${source}`));
    }

    if (destinationBuffer === null || destination === null) {
      issues.push(
        issueFor(
          asset,
          `expected destination file is missing or unreadable: ${asset.destinationPath}`
        )
      );
    } else if (typeof destination === "string") {
      issues.push(
        issueFor(asset, `destination file is invalid: ${destination}`)
      );
    }

    if (
      sourceBuffer !== null &&
      destinationBuffer !== null &&
      !sourceBuffer.equals(destinationBuffer)
    ) {
      issues.push(
        issueFor(asset, "canonical asset is not an exact copy of the source")
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
          issueFor(
            asset,
            `${label} canvas must be ${CHARACTER_CANVAS_SIZE.width}x${CHARACTER_CANVAS_SIZE.height}, got ${metadata.width}x${metadata.height}`
          )
        );
      }
      if (!metadata.hasAlpha) {
        issues.push(
          issueFor(asset, `${label} PNG does not declare alpha transparency`)
        );
      }
      parsedByMeaning.set(
        `${asset.characterId}/${asset.meaning}/${label}`,
        metadata
      );
    }
  }

  for (const characterId of [
    "character-mentor",
    "character-learner"
  ] as const) {
    for (const label of ["source", "destination"] as const) {
      const normalClosed = parsedByMeaning.get(
        `${characterId}/speak-normal-closed/${label}`
      );
      const normalOpen = parsedByMeaning.get(
        `${characterId}/speak-normal-open/${label}`
      );
      const pointingClosed = parsedByMeaning.get(
        `${characterId}/speak-pointing-closed/${label}`
      );
      const pointingOpen = parsedByMeaning.get(
        `${characterId}/speak-pointing-open/${label}`
      );
      for (const [pose, closed, open] of [
        ["speak-normal", normalClosed, normalOpen],
        ["speak-pointing", pointingClosed, pointingOpen]
      ] as const) {
        if (
          closed !== undefined &&
          open !== undefined &&
          (closed.width !== open.width || closed.height !== open.height)
        ) {
          const asset = characterAssetFiles.find(
            (candidate) =>
              candidate.characterId === characterId &&
              candidate.meaning === `${pose}-open`
          );
          if (asset !== undefined) {
            issues.push(
              issueFor(
                asset,
                `${label} ${pose} close/open canvas sizes do not match`
              )
            );
          }
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
        `[${issue.characterId}/${issue.meaning}] ${issue.message} (source: ${issue.expectedSourceFile}; destination: ${issue.expectedDestinationPath})`
    )
    .join("\n");
}
