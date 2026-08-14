import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  areTerminologyPreviewExclusionsDisabled,
  buildTerminologyPreviewRequest,
  getTerminologyPreviewActiveTermsKey,
  getTerminologyPreviewDraftKey,
  isTerminologyPreviewSnapshotCurrent
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
    ).toContain("プレビューを実行すると");
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

  it("invalidates a result when the draft or active terminology changes", () => {
    const draft = {
      spokenText: "経費精算",
      mode: "dictionary" as const,
      excludedTermIds: []
    };
    const activeTerm = {
      termId: "term-a",
      surface: "経費精算",
      normalizedSurface: "経費精算",
      readingKatakana: "ケイヒセイサン",
      category: "operation",
      priority: 0,
      notes: "",
      status: "active" as const,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    };
    const snapshot = {
      draftKey: getTerminologyPreviewDraftKey(draft),
      activeTermsKey: getTerminologyPreviewActiveTermsKey([activeTerm])
    };

    expect(
      isTerminologyPreviewSnapshotCurrent(
        snapshot,
        getTerminologyPreviewDraftKey(draft),
        getTerminologyPreviewActiveTermsKey([activeTerm])
      )
    ).toBe(true);

    expect(
      isTerminologyPreviewSnapshotCurrent(
        snapshot,
        getTerminologyPreviewDraftKey({
          ...draft,
          spokenText: "勤怠管理"
        }),
        snapshot.activeTermsKey
      )
    ).toBe(false);
    expect(
      isTerminologyPreviewSnapshotCurrent(
        snapshot,
        getTerminologyPreviewDraftKey({
          ...draft,
          mode: "literal"
        }),
        snapshot.activeTermsKey
      )
    ).toBe(false);
    expect(
      isTerminologyPreviewSnapshotCurrent(
        snapshot,
        getTerminologyPreviewDraftKey({
          ...draft,
          excludedTermIds: ["term-a"]
        }),
        snapshot.activeTermsKey
      )
    ).toBe(false);
    expect(
      isTerminologyPreviewSnapshotCurrent(
        snapshot,
        snapshot.draftKey,
        getTerminologyPreviewActiveTermsKey([
          { ...activeTerm, updatedAt: "2026-08-06T00:01:00.000Z" }
        ])
      )
    ).toBe(false);
  });
});
