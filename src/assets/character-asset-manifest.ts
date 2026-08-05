export const CHARACTER_CANVAS_SIZE = {
  width: 600,
  height: 1000
} as const;

export const characterAssetFiles = [
  {
    characterId: "character-mentor",
    meaning: "stand",
    sourceFile: "char03_stand01.png",
    destinationPath: "shared-assets/characters/character-mentor/stand/stand.png"
  },
  {
    characterId: "character-mentor",
    meaning: "speak-normal-closed",
    sourceFile: "char03_speak01_close.png",
    destinationPath:
      "shared-assets/characters/character-mentor/speak-normal/closed.png"
  },
  {
    characterId: "character-mentor",
    meaning: "speak-normal-open",
    sourceFile: "char03_speak01_open.png",
    destinationPath:
      "shared-assets/characters/character-mentor/speak-normal/open.png"
  },
  {
    characterId: "character-mentor",
    meaning: "speak-pointing-closed",
    sourceFile: "char03_speak02_close.png",
    destinationPath:
      "shared-assets/characters/character-mentor/speak-pointing/closed.png"
  },
  {
    characterId: "character-mentor",
    meaning: "speak-pointing-open",
    sourceFile: "char03_speak02_open.png",
    destinationPath:
      "shared-assets/characters/character-mentor/speak-pointing/open.png"
  },
  {
    characterId: "character-learner",
    meaning: "stand",
    sourceFile: "char04_stand01.png",
    destinationPath:
      "shared-assets/characters/character-learner/stand/stand.png"
  },
  {
    characterId: "character-learner",
    meaning: "speak-normal-closed",
    sourceFile: "char04_speak01_close.png",
    destinationPath:
      "shared-assets/characters/character-learner/speak-normal/closed.png"
  },
  {
    characterId: "character-learner",
    meaning: "speak-normal-open",
    sourceFile: "char04_speak01_open.png",
    destinationPath:
      "shared-assets/characters/character-learner/speak-normal/open.png"
  },
  {
    characterId: "character-learner",
    meaning: "speak-pointing-closed",
    sourceFile: "char04_speak02_close.png",
    destinationPath:
      "shared-assets/characters/character-learner/speak-pointing/closed.png"
  },
  {
    characterId: "character-learner",
    meaning: "speak-pointing-open",
    sourceFile: "char04_speak02_open.png",
    destinationPath:
      "shared-assets/characters/character-learner/speak-pointing/open.png"
  }
] as const;

export type CharacterAssetId =
  (typeof characterAssetFiles)[number]["characterId"];

export type CharacterVisualAssetPaths = {
  stand: string;
  speak: {
    normal: {
      closed: string;
      open: string;
    };
    pointing: {
      closed: string;
      open: string;
    };
  };
};

function assetPath(
  characterId: CharacterAssetId,
  meaning: (typeof characterAssetFiles)[number]["meaning"]
): string {
  const asset = characterAssetFiles.find(
    (candidate) =>
      candidate.characterId === characterId && candidate.meaning === meaning
  );
  if (asset === undefined) {
    throw new Error(
      `Missing character asset manifest entry: ${characterId}/${meaning}`
    );
  }
  return asset.destinationPath;
}

export function characterVisualAssetPaths(
  characterId: CharacterAssetId
): CharacterVisualAssetPaths {
  return {
    stand: assetPath(characterId, "stand"),
    speak: {
      normal: {
        closed: assetPath(characterId, "speak-normal-closed"),
        open: assetPath(characterId, "speak-normal-open")
      },
      pointing: {
        closed: assetPath(characterId, "speak-pointing-closed"),
        open: assetPath(characterId, "speak-pointing-open")
      }
    }
  };
}
