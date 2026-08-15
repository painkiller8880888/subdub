import { describe, expect, it } from "vitest";

import {
  isWorkspaceNavigationActive,
  readSidebarCollapsed,
  WORKSPACE_NAVIGATION,
  WORKSPACE_SIDEBAR_STORAGE_KEY,
  writeSidebarCollapsed
} from "../../src/web/workspace-navigation.js";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    }
  };
}

describe("workspace sidebar navigation", () => {
  it("keeps production routes highlighted as one project destination", () => {
    const projects = WORKSPACE_NAVIGATION.find(
      (item) => item.id === "projects"
    );
    if (projects === undefined) {
      throw new Error("projects navigation item is missing");
    }

    expect(isWorkspaceNavigationActive("/projects", projects)).toBe(true);
    expect(
      isWorkspaceNavigationActive("/projects/project-1/script", projects)
    ).toBe(true);
    expect(isWorkspaceNavigationActive("/character-visuals", projects)).toBe(
      false
    );
  });

  it("matches global pages without matching similarly prefixed routes", () => {
    const visuals = WORKSPACE_NAVIGATION.find(
      (item) => item.id === "character-visuals"
    );
    if (visuals === undefined) {
      throw new Error("character visual navigation item is missing");
    }

    expect(isWorkspaceNavigationActive("/character-visuals", visuals)).toBe(
      true
    );
    expect(
      isWorkspaceNavigationActive("/character-visuals-extra", visuals)
    ).toBe(false);
  });

  it("falls back to expanded when local preference is missing or unusable", () => {
    expect(readSidebarCollapsed(null)).toBe(false);
    const storage = createStorage();
    expect(readSidebarCollapsed(storage)).toBe(false);
    storage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, "unexpected");
    expect(readSidebarCollapsed(storage)).toBe(false);
  });

  it("persists only the UI preference and tolerates storage write errors", () => {
    const storage = createStorage();
    writeSidebarCollapsed(storage, true);
    expect(storage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY)).toBe("true");
    writeSidebarCollapsed(storage, false);
    expect(storage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY)).toBe("false");

    const brokenStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    } as unknown as Storage;
    expect(readSidebarCollapsed(brokenStorage)).toBe(false);
    expect(() => writeSidebarCollapsed(brokenStorage, true)).not.toThrow();
  });
});
