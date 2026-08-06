import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  areTerminologyPreviewExclusionsDisabled,
  buildTerminologyPreviewRequest
} from "../../src/web/terminology-preview-state.js";
import { TerminologyPreviewResultView } from "../../src/web/terminology-preview-view.js";

const result = {
  resolvedSpokenText: "READ",
  appliedTerms: [
    {
      termId: "term-a",
      surface: "A",
      reading: "READ",
      termUpdatedAt: "2026-08-06T00:00:00.000Z"
    }
  ]
};

describe("terminology preview UI state", () => {
  it("renders the empty, loading, error, and applied result states", () => {
    expect(
      renderToStaticMarkup(
        createElement(TerminologyPreviewResultView, {
          result: null,
          isPending: false,
          error: null
        })
      )
    ).toContain("Run a preview");
    expect(
      renderToStaticMarkup(
        createElement(TerminologyPreviewResultView, {
          result: null,
          isPending: true,
          error: null
        })
      )
    ).toContain('role="status"');
    expect(
      renderToStaticMarkup(
        createElement(TerminologyPreviewResultView, {
          result: null,
          isPending: false,
          error: "preview failed"
        })
      )
    ).toContain('role="alert"');
    const appliedMarkup = renderToStaticMarkup(
      createElement(TerminologyPreviewResultView, {
        result,
        isPending: false,
        error: null
      })
    );
    expect(appliedMarkup).toContain("READ");
    expect(appliedMarkup).toContain("term-a");
  });

  it("keeps draft exclusions and makes literal behavior explicit", () => {
    expect(
      buildTerminologyPreviewRequest({
        spokenText: "draft text",
        mode: "literal",
        excludedTermIds: ["term-a", "term-a"]
      })
    ).toEqual({
      spokenText: "draft text",
      pronunciation: { mode: "literal", excludedTermIds: ["term-a", "term-a"] }
    });
    expect(areTerminologyPreviewExclusionsDisabled("literal")).toBe(true);
    expect(areTerminologyPreviewExclusionsDisabled("dictionary")).toBe(false);
  });
});
