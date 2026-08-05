export const CHARACTER_CANVAS_SIZE = {
  width: 600,
  height: 1000
} as const;

export type CharacterVariantRenderType = "single-image" | "mouth-pair";

export type CharacterVariantFile = {
  readonly key: string;
  readonly sourceFile: string;
  readonly destinationPath: string;
};

export type CharacterVariant = {
  readonly variantId: string;
  readonly characterId: string;
  readonly label: string;
  readonly renderType: CharacterVariantRenderType;
  readonly tags: readonly string[];
  readonly files: readonly CharacterVariantFile[];
};

export type CharacterVariantCatalog = readonly CharacterVariant[];

export const characterVariantCatalog = [
  {
    variantId: "character-mentor-stand-v1",
    characterId: "character-mentor",
    label: "非会話状態",
    renderType: "single-image",
    tags: ["stand"],
    files: [
      {
        key: "single",
        sourceFile: "char03_stand01.png",
        destinationPath:
          "shared-assets/characters/character-mentor/stand/stand.png"
      }
    ]
  },
  {
    variantId: "character-mentor-speak-normal-v1",
    characterId: "character-mentor",
    label: "通常会話",
    renderType: "mouth-pair",
    tags: ["speak", "normal"],
    files: [
      {
        key: "closed",
        sourceFile: "char03_speak01_close.png",
        destinationPath:
          "shared-assets/characters/character-mentor/speak-normal/closed.png"
      },
      {
        key: "open",
        sourceFile: "char03_speak01_open.png",
        destinationPath:
          "shared-assets/characters/character-mentor/speak-normal/open.png"
      }
    ]
  },
  {
    variantId: "character-mentor-speak-pointing-v1",
    characterId: "character-mentor",
    label: "指差し状態の会話",
    renderType: "mouth-pair",
    tags: ["speak", "pointing"],
    files: [
      {
        key: "closed",
        sourceFile: "char03_speak02_close.png",
        destinationPath:
          "shared-assets/characters/character-mentor/speak-pointing/closed.png"
      },
      {
        key: "open",
        sourceFile: "char03_speak02_open.png",
        destinationPath:
          "shared-assets/characters/character-mentor/speak-pointing/open.png"
      }
    ]
  },
  {
    variantId: "character-learner-stand-v1",
    characterId: "character-learner",
    label: "非会話状態",
    renderType: "single-image",
    tags: ["stand"],
    files: [
      {
        key: "single",
        sourceFile: "char04_stand01.png",
        destinationPath:
          "shared-assets/characters/character-learner/stand/stand.png"
      }
    ]
  },
  {
    variantId: "character-learner-speak-normal-v1",
    characterId: "character-learner",
    label: "通常会話",
    renderType: "mouth-pair",
    tags: ["speak", "normal"],
    files: [
      {
        key: "closed",
        sourceFile: "char04_speak01_close.png",
        destinationPath:
          "shared-assets/characters/character-learner/speak-normal/closed.png"
      },
      {
        key: "open",
        sourceFile: "char04_speak01_open.png",
        destinationPath:
          "shared-assets/characters/character-learner/speak-normal/open.png"
      }
    ]
  },
  {
    variantId: "character-learner-speak-pointing-v1",
    characterId: "character-learner",
    label: "指差し状態の会話",
    renderType: "mouth-pair",
    tags: ["speak", "pointing"],
    files: [
      {
        key: "closed",
        sourceFile: "char04_speak02_close.png",
        destinationPath:
          "shared-assets/characters/character-learner/speak-pointing/closed.png"
      },
      {
        key: "open",
        sourceFile: "char04_speak02_open.png",
        destinationPath:
          "shared-assets/characters/character-learner/speak-pointing/open.png"
      }
    ]
  }
] as const satisfies CharacterVariantCatalog;

export type CharacterAssetId =
  (typeof characterVariantCatalog)[number]["characterId"];

export function characterVariantsForCharacter(
  characterId: string,
  catalog: CharacterVariantCatalog = characterVariantCatalog
): readonly CharacterVariant[] {
  return catalog.filter((variant) => variant.characterId === characterId);
}
