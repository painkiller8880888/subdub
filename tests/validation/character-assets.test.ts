import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { characterAssetFiles } from "../../src/assets/character-asset-manifest.js";
import {
  formatCharacterAssetIssues,
  validateCharacterAssets
} from "../../src/validation/character-assets.js";

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

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, crcInput, crc]);
}

function makePng(width: number, height: number, colorType: 2 | 6 = 6): Buffer {
  const channels = colorType === 6 ? 4 : 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const scanlines = Buffer.alloc((width * channels + 1) * height);
  const compressed = deflateSync(scanlines);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

describe("character asset validation", () => {
  const roots: string[] = [];
  const sourceFixtureRoot = fileURLToPath(
    new URL("../../doc/assets/", import.meta.url)
  );

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  async function copyAllAssets(): Promise<{
    root: string;
    sourceRoot: string;
    publicRoot: string;
  }> {
    const root = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-assets-")
    );
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const publicRoot = path.join(root, "public");

    await Promise.all(
      characterAssetFiles.map(async (asset) => {
        const sourcePath = path.join(sourceRoot, asset.sourceFile);
        const destinationPath = path.join(publicRoot, asset.destinationPath);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(
          path.join(sourceFixtureRoot, asset.sourceFile),
          sourcePath
        );
        await fs.copyFile(
          path.join(sourceFixtureRoot, asset.sourceFile),
          destinationPath
        );
      })
    );

    return { root, sourceRoot, publicRoot };
  }

  it("accepts all ten source and canonical assets", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const result = await validateCharacterAssets({ sourceRoot, publicRoot });

    expect(result.valid).toBe(true);
    expect(result.files).toHaveLength(10);
    expect(result.files.every((file) => file.source?.hasAlpha)).toBe(true);
    expect(result.files.every((file) => file.destination?.hasAlpha)).toBe(true);
  });

  it("reports the character, meaning, source, and destination when an asset is missing", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const missing = characterAssetFiles.find(
      (asset) =>
        asset.characterId === "character-learner" &&
        asset.meaning === "speak-pointing-open"
    );
    if (missing === undefined) {
      throw new Error("test manifest entry is missing");
    }
    await fs.rm(path.join(publicRoot, missing.destinationPath));

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    const issue = result.issues.find(
      (candidate) =>
        candidate.expectedDestinationPath === missing.destinationPath
    );
    expect(issue).toEqual(
      expect.objectContaining({
        characterId: "character-learner",
        meaning: "speak-pointing-open",
        expectedSourceFile: "char04_speak02_open.png",
        expectedDestinationPath:
          "shared-assets/characters/character-learner/speak-pointing/open.png"
      })
    );
    expect(formatCharacterAssetIssues(result.issues)).toContain(
      "character-learner/speak-pointing-open"
    );
  });

  it("rejects non-PNG files and unexpected source names", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = characterAssetFiles[0];
    await fs.writeFile(
      path.join(publicRoot, target.destinationPath),
      "not png"
    );
    await fs.writeFile(
      path.join(sourceRoot, "char03_speak03_open.png"),
      makePng(600, 1000)
    );

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        /PNG signature|too small/.test(issue.message)
      )
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.message.includes("unexpected character asset filename")
      )
    ).toBe(true);
  });

  it("rejects a canvas mismatch and a close/open pair mismatch", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = characterAssetFiles.find(
      (asset) =>
        asset.characterId === "character-mentor" &&
        asset.meaning === "speak-normal-open"
    );
    if (target === undefined) {
      throw new Error("test manifest entry is missing");
    }
    await fs.writeFile(
      path.join(publicRoot, target.destinationPath),
      makePng(601, 1000)
    );

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    expect(
      result.issues.some((issue) => issue.message.includes("canvas must be"))
    ).toBe(true);
    expect(
      result.issues.some((issue) =>
        issue.message.includes("speak-normal close/open canvas sizes")
      )
    ).toBe(true);
  });

  it("rejects PNGs without alpha channel or tRNS", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = characterAssetFiles[0];
    await fs.writeFile(
      path.join(publicRoot, target.destinationPath),
      makePng(600, 1000, 2)
    );

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    expect(
      result.issues.some((issue) =>
        issue.message.includes("does not declare alpha")
      )
    ).toBe(true);
  });
});
