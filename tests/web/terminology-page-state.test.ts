import { describe, expect, it } from "vitest";

import { hasTerminologyListFilters } from "../../src/web/terminology-page-state.js";

describe("terminology page empty-list state", () => {
  it("distinguishes an empty workspace from an empty filtered result", () => {
    expect(hasTerminologyListFilters({})).toBe(false);
    expect(hasTerminologyListFilters({ status: "active" })).toBe(true);
    expect(hasTerminologyListFilters({ surface: "SubDub" })).toBe(true);
  });
});
