import { describe, expect, it } from "vitest";

import { migratePersistedProject } from "../../src/app/projects/project-migrations.js";
import { characterVisualAssetPaths } from "../../src/assets/character-asset-manifest.js";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  videoProjectSchema
} from "../../src/schema/video-project.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("project schema migrations", () => {
  it("migrates the old 1.0.0 visual asset shape to canonical paths", () => {
    const legacy = clone(videoProjectFixture) as Record<string, unknown> & {
      characters: Array<Record<string, unknown>>;
    };
    legacy.schemaVersion = "1.0.0";
    legacy.characters = legacy.characters.map((character) => {
      const characterId = character.id as string;
      return {
        ...character,
        visualAssets: {
          neutral: {
            closed: `characters/${characterId}/neutral/closed.png`,
            open: `characters/${characterId}/neutral/open.png`
          },
          smile: {
            closed: `characters/${characterId}/smile/closed.png`,
            open: `characters/${characterId}/smile/open.png`
          },
          explain: {
            closed: `characters/${characterId}/explain/closed.png`,
            open: `characters/${characterId}/explain/open.png`
          },
          caution: {
            closed: `characters/${characterId}/caution/closed.png`,
            open: `characters/${characterId}/caution/open.png`
          }
        }
      };
    });

    const migrated = migratePersistedProject(legacy);
    const parsed = videoProjectSchema.parse(migrated);

    expect(parsed.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(parsed.characters[0]?.visualAssets).toEqual(
      characterVisualAssetPaths("character-mentor")
    );
    expect(parsed.characters[1]?.visualAssets).toEqual(
      characterVisualAssetPaths("character-learner")
    );
  });

  it("does not upgrade an incomplete legacy character shape", () => {
    const legacy = clone(videoProjectFixture) as Record<string, unknown>;
    legacy.schemaVersion = "1.0.0";

    expect(migratePersistedProject(legacy)).toEqual(legacy);
  });
});
