import { describe, expect, it } from "vitest";

import {
  CURRENT_VIDEO_PROJECT_SCHEMA_VERSION,
  migrateVideoProject,
  migrateVideoProjectWithDiagnostics
} from "../../src/app/projects/video-project-migration.js";
import {
  legacyVideoProjectSchema,
  legacyVideoProjectV11Schema,
  videoProjectV13Schema,
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
    delete assignment.display.displayCoordinateSpace;
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

  const scriptWithTemplates = legacy.script as {
    sections: Array<{
      screenTemplateId?: unknown;
      lines: Array<{ screenTemplateId?: unknown }>;
    }>;
  };
  for (const section of scriptWithTemplates.sections) {
    delete section.screenTemplateId;
    for (const line of section.lines) {
      delete line.screenTemplateId;
    }
  }

  return legacy;
}

describe("video project schema migration", () => {
  it("upgrades the 1.0.0 fixed mapping to explicit bindings and section selections", () => {
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
    legacy.revision = 7;
    expect(legacyVideoProjectV11Schema.safeParse(legacy).success).toBe(true);

    const result = migrateVideoProjectWithDiagnostics(legacy);

    expect(result.migrated).toBe(true);
    expect(result.migrationId).toMatch(
      /^video-project-migration-[0-9a-f]{64}$/
    );
    expect(result.logEntries).toHaveLength(3);
    expect(result.logEntries[0]).toMatchObject({
      fromSchemaVersion: "1.1.0",
      toSchemaVersion: "1.2.0",
      kind: "unresolved_legacy_bgm",
      sectionId: "section-intro",
      legacyPath: "media/bgm-intro.mp3",
      legacyVolume: 0.25
    });
    expect(result.logEntries[2]).toMatchObject({
      fromSchemaVersion: "1.2.0",
      toSchemaVersion: "1.3.0",
      kind: "screen_template_selection",
      templateId: "screen-template-standard"
    });

    const migrated = videoProjectSchema.parse(result.project);
    expect(migrated.schemaVersion).toBe("1.4.0");
    expect(migrated.revision).toBe(8);
    expect(
      migrated.script.sections.every(
        (section) => section.screenTemplateId === "screen-template-standard"
      )
    ).toBe(true);
    for (const line of migrated.script.sections.flatMap(
      (section) => section.lines
    )) {
      expect(line).not.toHaveProperty("screenTemplateId");
    }
    expect(migrated.edit).toEqual({ videoElements: [], sectionBgms: [] });
    expect(migrated.audio).toEqual({
      soundEffects: (legacy.audio as { soundEffects: unknown[] }).soundEffects
    });
    expect(migrated.visuals.assignments[0]?.display).toMatchObject({
      kind: "video",
      volume: 0,
      displayCoordinateSpace: "legacy-media-frame"
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
    expect((migrated as typeof current).schemaVersion).toBe("1.4.0");
  });

  it("removes 1.3.0 line overrides and logs only non-null overrides", () => {
    const project = clone(videoProjectFixture) as unknown as Record<
      string,
      unknown
    >;
    project.schemaVersion = "1.3.0";
    const script = project.script as {
      sections: Array<{
        id: string;
        screenTemplateId: string;
        lines: Array<Record<string, unknown>>;
      }>;
    };
    for (const section of script.sections) {
      for (const line of section.lines) {
        line.screenTemplateId = null;
      }
    }
    const overrideSection = script.sections[1];
    const overrideLine = overrideSection?.lines[1];
    if (overrideSection === undefined || overrideLine === undefined) {
      throw new Error("migration fixture line is missing");
    }
    overrideLine.screenTemplateId = "screen-template-alternate";

    expect(videoProjectV13Schema.safeParse(project).success).toBe(true);
    const before = clone(project);
    const result = migrateVideoProjectWithDiagnostics(project, {
      standardTemplateAvailable: false
    });

    expect(result.migrated).toBe(true);
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0]).toMatchObject({
      fromSchemaVersion: "1.3.0",
      toSchemaVersion: "1.4.0",
      kind: "removed_line_screen_template_override",
      sectionId: overrideSection.id,
      lineId: overrideLine.id,
      oldLineScreenTemplateId: "screen-template-alternate",
      effectiveSectionScreenTemplateId: overrideSection.screenTemplateId
    });

    const migrated = videoProjectSchema.parse(result.project);
    expect(migrated.schemaVersion).toBe("1.4.0");
    expect(migrated.revision).toBe((project.revision as number) + 1);
    expect(
      migrated.script.sections.map((section) => section.screenTemplateId)
    ).toEqual(script.sections.map((section) => section.screenTemplateId));
    for (const line of migrated.script.sections.flatMap(
      (section) => section.lines
    )) {
      expect(line).not.toHaveProperty("screenTemplateId");
    }
    expect(project).toEqual(before);

    const rerun = migrateVideoProjectWithDiagnostics(migrated);
    expect(rerun.migrated).toBe(false);
    expect(rerun.project).toBe(migrated);
    expect(rerun.logEntries).toEqual([]);
  });

  it("rejects malformed 1.3.0 input before migration", () => {
    const malformed = clone(videoProjectFixture) as unknown as Record<
      string,
      unknown
    >;
    malformed.schemaVersion = "1.3.0";
    const script = malformed.script as {
      sections: Array<{ lines: Array<Record<string, unknown>> }>;
    };
    delete script.sections[0]!.lines[0]!.screenTemplateId;

    expect(videoProjectV13Schema.safeParse(malformed).success).toBe(false);
    const result = migrateVideoProjectWithDiagnostics(malformed);
    expect(result.migrated).toBe(false);
    expect(result.project).toBe(malformed);
  });

  it("does not mutate a strict 1.2.0 project when the standard template is unavailable", () => {
    const project = clone(videoProjectFixture) as unknown as Record<
      string,
      unknown
    >;
    project.schemaVersion = "1.2.0";
    const script = project.script as {
      sections: Array<{
        screenTemplateId: unknown;
        lines: Array<{ screenTemplateId: unknown }>;
      }>;
    };
    for (const section of script.sections) {
      delete section.screenTemplateId;
      for (const line of section.lines) {
        delete line.screenTemplateId;
      }
    }
    const visuals = project.visuals as {
      assignments: Array<{ display: Record<string, unknown> }>;
    };
    for (const assignment of visuals.assignments) {
      delete assignment.display.displayCoordinateSpace;
    }

    const before = clone(project);
    const result = migrateVideoProjectWithDiagnostics(project, {
      standardTemplateAvailable: false
    });

    expect(result.migrated).toBe(false);
    expect(result.blockedReason).toBe("standard_template_unavailable");
    expect(result.project).toBe(project);
    expect(project).toEqual(before);
  });

  it("does not migrate when the standard template is inactive", () => {
    const project = clone(videoProjectFixture) as unknown as Record<
      string,
      unknown
    >;
    project.schemaVersion = "1.2.0";
    const script = project.script as {
      sections: Array<{
        screenTemplateId: unknown;
        lines: Array<{ screenTemplateId: unknown }>;
      }>;
    };
    for (const section of script.sections) {
      delete section.screenTemplateId;
      for (const line of section.lines) {
        delete line.screenTemplateId;
      }
    }
    const visuals = project.visuals as {
      assignments: Array<{ display: Record<string, unknown> }>;
    };
    for (const assignment of visuals.assignments) {
      delete assignment.display.displayCoordinateSpace;
    }

    const before = clone(project);
    const result = migrateVideoProjectWithDiagnostics(project, {
      screenTemplateCatalog: {
        findById: () => ({ status: "inactive" })
      }
    });

    expect(result.migrated).toBe(false);
    expect(result.blockedReason).toBe("standard_template_unavailable");
    expect(result.project).toBe(project);
    expect(project).toEqual(before);
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
