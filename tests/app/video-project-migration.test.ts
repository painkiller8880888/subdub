import { describe, expect, it } from "vitest";

import {
  CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
  migrateVideoProject,
  migrateVideoProjectWithDiagnostics
} from "../../src/app/projects/video-project-migration.js";
import {
  legacyVideoProjectSchema,
  legacyVideoProjectV11Schema,
  videoProjectSchema
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function legacyProject(
  schemaVersion: "1.0.0" | "1.1.0"
): Record<string, unknown> {
  const legacy = clone(videoProjectFixture) as unknown as Record<
    string,
    unknown
  >;
  const edit = legacy.edit as {
    sectionBgms: Array<{
      id: string;
      sectionId: string;
      assetVersion: number;
      assetChecksum: string;
      projectMediaPath: string;
      volume: number;
    }>;
  };
  const audio = legacy.audio as { soundEffects: unknown[] };
  legacy.schemaVersion = schemaVersion;
  legacy.audio = {
    sectionBgms: edit.sectionBgms.map((bgm) => ({
      id: bgm.id,
      sectionId: bgm.sectionId,
      path: bgm.projectMediaPath,
      volume: bgm.volume,
      loop: true,
      fadeInMs: 0,
      fadeOutMs: 0
    })),
    soundEffects: audio.soundEffects
  };
  legacy.inserts = {
    opening: {
      id: "insert-opening",
      kind: "placeholder",
      slot: "opening",
      durationMs: 2000
    },
    ending: {
      id: "insert-ending",
      kind: "placeholder",
      slot: "ending",
      durationMs: 2000
    },
    eyeCatches: []
  };
  delete legacy.edit;

  const visuals = legacy.visuals as {
    assignments: Array<{ display: Record<string, unknown> }>;
  };
  for (const assignment of visuals.assignments) {
    if (assignment.display.kind !== "video") {
      continue;
    }
    assignment.display.muted = assignment.display.volume === 0;
    delete assignment.display.volume;
  }

  if (schemaVersion === "1.0.0") {
    for (const character of legacy.characters as Array<
      Record<string, unknown>
    >) {
      delete character.characterVisual;
    }
    const script = legacy.script as {
      sections: Array<{ lines: Array<Record<string, unknown>> }>;
    };
    for (const section of script.sections) {
      for (const line of section.lines) {
        delete line.characterVariantId;
      }
    }
  }

  return legacy;
}

describe("video project schema migration", () => {
  it("upgrades the 1.0.0 fixed mapping to explicit bindings and line selections", () => {
    const legacy = legacyProject("1.0.0");

    expect(legacyVideoProjectSchema.safeParse(legacy).success).toBe(true);
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

  it("migrates 1.1.0 EditPlan, binary video volume, and legacy BGM diagnostics", () => {
    const legacy = legacyProject("1.1.0");
    expect(legacyVideoProjectV11Schema.safeParse(legacy).success).toBe(true);

    const result = migrateVideoProjectWithDiagnostics(legacy);

    expect(result.migrated).toBe(true);
    expect(result.migrationId).toMatch(
      /^video-project-migration-[0-9a-f]{64}$/
    );
    expect(result.logEntries).toHaveLength(2);
    expect(result.logEntries[0]).toMatchObject({
      fromSchemaVersion: "1.1.0",
      toSchemaVersion: "1.2.0",
      kind: "unresolved_legacy_bgm",
      sectionId: "section-intro",
      legacyPath: "media/bgm-intro.mp3",
      legacyVolume: 0.25
    });

    const migrated = videoProjectSchema.parse(result.project);
    expect(migrated.schemaVersion).toBe("1.2.0");
    expect(migrated.edit).toEqual({ videoElements: [], sectionBgms: [] });
    expect(migrated.audio).toEqual({
      soundEffects: (legacy.audio as { soundEffects: unknown[] }).soundEffects
    });
    expect(migrated.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      volume: 0
    });
    expect(migrated.visuals.assignments[0]?.display).not.toHaveProperty(
      "muted"
    );
    expect(legacy).not.toHaveProperty("edit");
    expect(legacy.schemaVersion).toBe("1.1.0");
  });

  it("maps an unmuted legacy video display to volume 1", () => {
    const legacy = legacyProject("1.1.0");
    const visuals = legacy.visuals as {
      assignments: Array<{ display: Record<string, unknown> }>;
    };
    visuals.assignments[0]!.display.muted = false;

    const migrated = videoProjectSchema.parse(migrateVideoProject(legacy));

    expect(migrated.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      volume: 1
    });
  });

  it("does not infer or rewrite projects from the current schema version", () => {
    const current = clone(videoProjectFixture);
    const migrated = migrateVideoProject(current);

    expect(migrated).toBe(current);
    expect((migrated as typeof current).schemaVersion).toBe("1.2.0");
  });

  it("rejects 1.1.0-only fields before migrating a 1.0.0 project", () => {
    const mixed = legacyProject("1.0.0");
    mixed.edit = { videoElements: [], sectionBgms: [] };

    expect(legacyVideoProjectSchema.safeParse(mixed).success).toBe(false);
    expect(migrateVideoProject(mixed)).toBe(mixed);
    expect(
      videoProjectSchema.safeParse(migrateVideoProject(mixed)).success
    ).toBe(false);
  });
});
