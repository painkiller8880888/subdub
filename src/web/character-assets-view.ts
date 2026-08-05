import type { Character, VideoProject } from "../schema/index.js";

type CharacterAssetSpeakPoseView = {
  readonly key: "normal" | "pointing";
  readonly label: string;
  readonly closed: string;
  readonly open: string;
};

type CharacterAssetStandPoseView = {
  readonly key: "stand";
  readonly label: string;
  readonly path: string;
};

export type CharacterAssetPoseView =
  CharacterAssetSpeakPoseView | CharacterAssetStandPoseView;

export type CharacterAssetViewModel = {
  readonly id: Character["id"];
  readonly name: string;
  readonly role: Character["role"];
  readonly speakerName: Character["voicevox"]["speakerName"];
  readonly styleName: Character["voicevox"]["styleName"];
  readonly availablePoses: readonly CharacterAssetPoseView[];
};

export function toCharacterAssetViewModel(
  character: Character
): CharacterAssetViewModel {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    speakerName: character.voicevox.speakerName,
    styleName: character.voicevox.styleName,
    availablePoses: [
      {
        key: "normal",
        label: "通常会話",
        closed: character.visualAssets.speak.normal.closed,
        open: character.visualAssets.speak.normal.open
      },
      {
        key: "pointing",
        label: "指差し状態の会話",
        closed: character.visualAssets.speak.pointing.closed,
        open: character.visualAssets.speak.pointing.open
      },
      {
        key: "stand",
        label: "非会話状態",
        path: character.visualAssets.stand
      }
    ]
  };
}

export function toCharacterAssetViewModels(
  project: VideoProject
): CharacterAssetViewModel[] {
  return project.characters.map(toCharacterAssetViewModel);
}

export function characterAssetUrl(assetPath: string): string {
  return `/${assetPath}`;
}
