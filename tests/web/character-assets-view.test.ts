import { describe, expect, it } from "vitest";

import { legacyCharacterVariantCatalog as characterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import type { CharacterVariant } from "../../src/assets/character-asset-manifest.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  characterAssetUrl,
  characterVisualSnapshotToCharacterAssetCatalog,
  toCharacterAssetViewModels
} from "../../src/web/character-assets-view.js";
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";

describe("character asset view model", () => {
  it("maps a database snapshot to read-only browser asset URLs", () => {
    const snapshot = characterVisualCatalogSnapshotSchema.parse([
      {
        visualId: "character-mentor",
        name: "Mentor",
        description: "",
        status: "active",
        baseWidth: 600,
        baseHeight: 1000,
        variants: [
          {
            variantId: "character-mentor-stand-v1",
            label: "Stand",
            renderType: "single-image",
            tags: [],
            files: [
              {
                key: "single",
                libraryPath:
                  "library/character-visuals/character-mentor/character-mentor-stand-v1/single.png",
                mimeType: "image/png",
                checksum: "0".repeat(64),
                sizeBytes: 1,
                width: 600,
                height: 1000
              }
            ]
          },
          {
            variantId: "character-mentor-disabled-v1",
            label: "Disabled",
            renderType: "single-image",
            status: "inactive",
            tags: [],
            files: [
              {
                key: "single",
                libraryPath:
                  "library/character-visuals/character-mentor/character-mentor-disabled-v1/single.png",
                mimeType: "image/png",
                checksum: "1".repeat(64),
                sizeBytes: 1,
                width: 600,
                height: 1000
              }
            ]
          }
        ],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z"
      }
    ]);

    const [variant] = characterVisualSnapshotToCharacterAssetCatalog(snapshot);

    expect(
      characterVisualSnapshotToCharacterAssetCatalog(snapshot)
    ).toHaveLength(1);
    expect(variant?.files[0]?.destinationPath).toBe(
      "api/character-visuals/character-mentor/character-mentor-stand-v1/single"
    );
  });

  it("lists catalog variants by character without using VideoProject visualAssets", () => {
    const project = createEmptyVideoProject({
      projectId: "character-view-project",
      createdAt: "2026-08-05T00:00:00.000Z"
    });
    project.characters[0].characterVisual = {
      visualId: "character-mentor",
      idleVariantId: "character-mentor-stand-v1"
    };
    project.characters[1].characterVisual = {
      visualId: "character-learner",
      idleVariantId: "character-learner-stand-v1"
    };
    const characters = toCharacterAssetViewModels(
      project,
      characterVariantCatalog
    );

    expect(characters.map((character) => character.name)).toEqual([
      "四国めたん",
      "ずんだもん"
    ]);
    expect(characters.map((character) => character.speakerName)).toEqual([
      "四国めたん",
      "ずんだもん"
    ]);
    expect(
      characters.map((character) =>
        character.availableVariants.map((variant) => variant.label)
      )
    ).toEqual([
      ["非会話状態", "通常会話", "指差し状態の会話"],
      ["非会話状態", "通常会話", "指差し状態の会話"]
    ]);

    const mentor = characters[0];
    if (mentor === undefined) {
      throw new Error("mentor view model is missing");
    }
    expect(mentor.availableVariants[0]).toMatchObject({
      variantId: "character-mentor-stand-v1",
      renderType: "single-image",
      files: [
        {
          key: "single",
          path: "shared-assets/characters/character-mentor/stand/stand.png"
        }
      ]
    });
    expect(mentor.availableVariants[1]).toMatchObject({
      variantId: "character-mentor-speak-normal-v1",
      renderType: "mouth-pair",
      files: [
        {
          key: "closed",
          path: "shared-assets/characters/character-mentor/speak-normal/closed.png"
        },
        {
          key: "open",
          path: "shared-assets/characters/character-mentor/speak-normal/open.png"
        }
      ]
    });
    expect(characterAssetUrl(mentor.availableVariants[0].files[0].path)).toBe(
      "/shared-assets/characters/character-mentor/stand/stand.png"
    );
  });

  it("does not infer a visual set from the project character id", () => {
    const project = createEmptyVideoProject({
      projectId: "unbound-character-view-project",
      createdAt: "2026-08-05T00:00:00.000Z"
    });

    expect(
      toCharacterAssetViewModels(project, characterVariantCatalog).map(
        (character) => character.availableVariants
      )
    ).toEqual([[], []]);
  });

  it("reflects a catalog variant addition in the character view", () => {
    const project = createEmptyVideoProject({
      projectId: "character-view-project",
      createdAt: "2026-08-05T00:00:00.000Z"
    });
    project.characters[0].characterVisual = {
      visualId: "character-mentor",
      idleVariantId: "character-mentor-stand-v1"
    };
    project.characters[1].characterVisual = {
      visualId: "character-learner",
      idleVariantId: "character-learner-stand-v1"
    };
    const extraVariant: CharacterVariant = {
      variantId: "character-learner-extra-v1",
      characterId: "character-learner",
      label: "追加バリアント",
      renderType: "single-image",
      tags: ["additional"],
      files: [
        {
          key: "single",
          sourceFile: "char04_extra.png",
          destinationPath:
            "shared-assets/characters/character-learner/extra/image.png"
        }
      ]
    };
    const characters = toCharacterAssetViewModels(project, [
      ...characterVariantCatalog,
      extraVariant
    ]);
    const learner = characters.find(
      (character) => character.id === "character-learner"
    );

    expect(learner?.availableVariants.at(-1)).toEqual({
      variantId: extraVariant.variantId,
      label: extraVariant.label,
      renderType: extraVariant.renderType,
      tags: extraVariant.tags,
      files: [{ key: "single", path: extraVariant.files[0].destinationPath }]
    });
  });
});
