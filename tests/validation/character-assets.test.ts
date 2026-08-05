import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  characterVariantCatalog,
  type CharacterVariant,
  type CharacterVariantCatalog
} from "../../src/assets/character-asset-manifest.js";
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

function catalogFiles(catalog: CharacterVariantCatalog) {
  return catalog.flatMap((variant) =>
    variant.files.map((file) => ({ ...file, variantId: variant.variantId }))
  );
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

  async function copyAllAssets(
    catalog: CharacterVariantCatalog = characterVariantCatalog
  ): Promise<{ sourceRoot: string; publicRoot: string }> {
    const root = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-character-assets-")
    );
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const publicRoot = path.join(root, "public");

    for (const asset of catalogFiles(catalog)) {
      const sourcePath = path.join(sourceRoot, asset.sourceFile);
      const destinationPath = path.join(publicRoot, asset.destinationPath);
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      try {
        await fs.copyFile(
          path.join(sourceFixtureRoot, asset.sourceFile),
          sourcePath
        );
      } catch {
        await fs.writeFile(sourcePath, makePng(600, 1000));
      }
      await fs.copyFile(sourcePath, destinationPath);
    }

    return { sourceRoot, publicRoot };
  }

  it("accepts all catalog-registered source and public assets", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const result = await validateCharacterAssets({ sourceRoot, publicRoot });

    expect(result.valid).toBe(true);
    expect(result.files).toHaveLength(10);
    expect(result.files.every((file) => file.source?.hasAlpha)).toBe(true);
    expect(result.files.every((file) => file.destination?.hasAlpha)).toBe(true);
  });

  it("accepts a single-image variant independently", async () => {
    const catalog = characterVariantCatalog.filter(
      (variant) => variant.renderType === "single-image"
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it("accepts a mouth-pair variant independently", async () => {
    const catalog = characterVariantCatalog.filter(
      (variant) => variant.variantId === "character-mentor-speak-normal-v1"
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(true);
    expect(result.files).toHaveLength(2);
  });

  it("reflects a newly registered variant in validation", async () => {
    const extraVariant: CharacterVariant = {
      variantId: "character-mentor-additional-v1",
      characterId: "character-mentor",
      label: "追加確認用",
      renderType: "single-image",
      tags: ["additional"],
      files: [
        {
          key: "single",
          sourceFile: "char03_additional.png",
          destinationPath:
            "shared-assets/characters/character-mentor/additional/image.png"
        }
      ]
    };
    const catalog = [...characterVariantCatalog, extraVariant];
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(true);
    expect(result.files).toHaveLength(11);
    expect(result.files.at(-1)?.variantId).toBe(extraVariant.variantId);
  });

  it("reports missing closed or open files from a mouth-pair catalog entry", async () => {
    const sourceVariant = characterVariantCatalog.find(
      (variant) => variant.renderType === "mouth-pair"
    );
    if (sourceVariant === undefined) {
      throw new Error("mouth-pair fixture is missing");
    }
    const incompleteVariant: CharacterVariant = {
      ...sourceVariant,
      files: sourceVariant.files.filter((file) => file.key !== "closed")
    };
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === sourceVariant.variantId
        ? incompleteVariant
        : variant
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: sourceVariant.variantId,
          meaning: "closed",
          message: "closed file is missing"
        })
      ])
    );
  });

  it("rejects duplicate variant IDs", async () => {
    const duplicate = {
      ...characterVariantCatalog[1],
      variantId: characterVariantCatalog[0].variantId
    };
    const catalog = [...characterVariantCatalog, duplicate];
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "variantId is duplicated" })
      ])
    );
  });

  it("rejects registering the same file for multiple meanings", async () => {
    const first = characterVariantCatalog[0];
    const second = characterVariantCatalog[3];
    const firstFile = first.files[0];
    const secondFile = second.files[0];
    const duplicateVariant: CharacterVariant = {
      ...second,
      files: [{ ...secondFile, sourceFile: firstFile.sourceFile }]
    };
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === second.variantId ? duplicateVariant : variant
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.message.includes("source file is registered more than once")
      )
    ).toBe(true);
  });

  it("reports a missing asset with variant and expected paths", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const missing = characterVariantCatalog
      .flatMap((variant) => variant.files.map((file) => ({ variant, file })))
      .find(
        ({ variant, file }) =>
          variant.characterId === "character-learner" && file.key === "open"
      );
    if (missing === undefined) {
      throw new Error("test catalog entry is missing");
    }
    await fs.rm(path.join(publicRoot, missing.file.destinationPath));

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    const issue = result.issues.find(
      (candidate) =>
        candidate.expectedDestinationPath === missing.file.destinationPath
    );
    expect(issue).toEqual(
      expect.objectContaining({
        characterId: "character-learner",
        variantId: missing.variant.variantId,
        meaning: "open",
        expectedSourceFile: "char04_speak01_open.png",
        expectedDestinationPath:
          "shared-assets/characters/character-learner/speak-normal/open.png"
      })
    );
    expect(formatCharacterAssetIssues(result.issues)).toContain(
      `${missing.variant.variantId}/open`
    );
  });

  it("rejects non-PNG files and unexpected source names", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = catalogFiles(characterVariantCatalog)[0];
    await fs.writeFile(
      path.join(publicRoot, target.destinationPath),
      "not png"
    );
    await fs.writeFile(
      path.join(sourceRoot, "char05_new_pose.png"),
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

  it("rejects an invalid PNG CRC", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = catalogFiles(characterVariantCatalog)[0];
    const destinationPath = path.join(publicRoot, target.destinationPath);
    const corrupted = await fs.readFile(destinationPath);
    corrupted[25] ^= 1;
    await fs.writeFile(destinationPath, corrupted);

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    expect(
      result.issues.some((issue) => issue.message.includes("invalid CRC"))
    ).toBe(true);
  });

  it("rejects a canvas mismatch and a close/open pair mismatch", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = characterVariantCatalog
      .find(
        (variant) => variant.variantId === "character-mentor-speak-normal-v1"
      )
      ?.files.find((file) => file.key === "open");
    if (target === undefined) {
      throw new Error("test catalog entry is missing");
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
        issue.message.includes("close/open canvas sizes")
      )
    ).toBe(true);
  });

  it("rejects PNGs without alpha channel or tRNS", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = catalogFiles(characterVariantCatalog)[0];
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

  it("rejects a source and public byte mismatch", async () => {
    const { sourceRoot, publicRoot } = await copyAllAssets();
    const target = catalogFiles(characterVariantCatalog)[0];
    await fs.writeFile(
      path.join(publicRoot, target.destinationPath),
      makePng(600, 1000)
    );

    const result = await validateCharacterAssets({ sourceRoot, publicRoot });
    expect(
      result.issues.some((issue) =>
        issue.message.includes("not an exact copy of the source")
      )
    ).toBe(true);
  });

  it("rejects a destination outside the variant character namespace", async () => {
    const sourceVariant = characterVariantCatalog[0];
    const invalidVariant: CharacterVariant = {
      ...sourceVariant,
      variantId: "character-mentor-wrong-namespace-v1",
      files: [
        {
          ...sourceVariant.files[0],
          destinationPath:
            "shared-assets/characters/character-learner/stand/wrong.png"
        }
      ]
    };
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === sourceVariant.variantId ? invalidVariant : variant
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: invalidVariant.variantId,
          message:
            "destination path must be under shared-assets/characters/character-mentor/"
        })
      ])
    );
  });

  it("rejects a non-PNG canonical destination", async () => {
    const sourceVariant = characterVariantCatalog[0];
    const invalidVariant: CharacterVariant = {
      ...sourceVariant,
      variantId: "character-mentor-wrong-extension-v1",
      files: [
        {
          ...sourceVariant.files[0],
          destinationPath:
            "shared-assets/characters/character-mentor/stand/stand.jpg"
        }
      ]
    };
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === sourceVariant.variantId ? invalidVariant : variant
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: invalidVariant.variantId,
          message: "canonical character asset destination must end with .png"
        })
      ])
    );
  });

  it("rejects a destination outside the character asset namespace", async () => {
    const sourceVariant = characterVariantCatalog[0];
    const invalidVariant: CharacterVariant = {
      ...sourceVariant,
      variantId: "character-mentor-outside-namespace-v1",
      files: [
        {
          ...sourceVariant.files[0],
          destinationPath: "shared-assets/library/stand.png"
        }
      ]
    };
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === sourceVariant.variantId ? invalidVariant : variant
    );
    const { sourceRoot, publicRoot } = await copyAllAssets(catalog);
    const result = await validateCharacterAssets({
      sourceRoot,
      publicRoot,
      catalog
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: invalidVariant.variantId,
          message:
            "destination path must be under shared-assets/characters/character-mentor/"
        })
      ])
    );
  });
});
