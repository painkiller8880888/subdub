import { describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  characterAssetUrl,
  toCharacterAssetViewModels
} from "../../src/web/character-assets-view.js";

describe("character asset view model", () => {
  it("exposes both speakers and only the real poses and mouth pairs", () => {
    const project = createEmptyVideoProject({
      projectId: "character-view-project",
      createdAt: "2026-08-05T00:00:00.000Z"
    });
    const characters = toCharacterAssetViewModels(project);

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
        character.availablePoses.map((pose) => pose.label)
      )
    ).toEqual([
      ["通常会話", "指差し状態の会話", "非会話状態"],
      ["通常会話", "指差し状態の会話", "非会話状態"]
    ]);

    const mentor = characters[0];
    if (mentor === undefined) {
      throw new Error("mentor view model is missing");
    }
    const normal = mentor.availablePoses[0];
    const pointing = mentor.availablePoses[1];
    const stand = mentor.availablePoses[2];
    expect(normal).toMatchObject({
      closed:
        "shared-assets/characters/character-mentor/speak-normal/closed.png",
      open: "shared-assets/characters/character-mentor/speak-normal/open.png"
    });
    expect(pointing).toMatchObject({
      closed:
        "shared-assets/characters/character-mentor/speak-pointing/closed.png",
      open: "shared-assets/characters/character-mentor/speak-pointing/open.png"
    });
    expect(stand).toEqual({
      key: "stand",
      label: "非会話状態",
      path: "shared-assets/characters/character-mentor/stand/stand.png"
    });
    if (stand.key !== "stand") {
      throw new Error("stand view model is not a stand pose");
    }
    expect(
      characters.flatMap((character) => character.availablePoses)
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "smile" }),
        expect.objectContaining({ label: "caution" })
      ])
    );
    expect(characterAssetUrl(stand.path)).toBe(
      "/shared-assets/characters/character-mentor/stand/stand.png"
    );
  });
});
