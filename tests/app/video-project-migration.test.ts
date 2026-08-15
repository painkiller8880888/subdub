import { describe, expect, it } from "vitest";

import {
  CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
  migrateVideoProject
} from "../../src/app/projects/video-project-migration.js";
import { videoProjectSchema } from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("video project schema migration", () => {
  it("upgrades the legacy fixed mapping to explicit bindings and line selections", () => {
    const legacy = clone(videoProjectFixture) as Record<string, unknown>;
    legacy.schemaVersion = "1.0.0";
    const characters = legacy.characters as Array<Record<string, unknown>>;
    for (const character of characters) {
      delete character.characterVisual;
    }
    const script = legacy.script as Record<string, unknown>;
    const sections = script.sections as Array<Record<string, unknown>>;
    for (const section of sections) {
      for (const line of section.lines as Array<Record<string, unknown>>) {
        delete line.characterVariantId;
      }
    }

    const migrated = migrateVideoProject(legacy);

    expect(migrated).toMatchObject({
      schemaVersion: CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
      characters: [
        {
          id: "character-mentor",
          characterVisual: {
            visualId: "character-mentor",
            idleVariantId: "character-mentor-stand-v1"
          }
        },
        {
          id: "character-learner",
          characterVisual: {
            visualId: "character-learner",
            idleVariantId: "character-learner-stand-v1"
          }
        }
      ]
    });
    expect(
      (
        migrated as { script: { sections: Array<{ lines: unknown[] }> } }
      ).script.sections.flatMap((section) => section.lines)
    ).not.toContainEqual(expect.objectContaining({ characterVariantId: null }));
    expect(videoProjectSchema.safeParse(migrated).success).toBe(true);
    expect(legacy.schemaVersion).toBe("1.0.0");
  });

  it("does not infer or rewrite projects from another schema version", () => {
    const current = clone(videoProjectFixture);
    const migrated = migrateVideoProject(current);

    expect(migrated).toBe(current);
    expect((migrated as typeof current).schemaVersion).toBe("1.1.0");
  });
});
