import { createElement } from "react";

import type { TerminologyPreviewResult } from "../schema/api.js";

export function TerminologyPreviewResultView({
  result,
  isPending,
  error
}: {
  readonly result: TerminologyPreviewResult | null;
  readonly isPending: boolean;
  readonly error: string | null;
}) {
  if (isPending) {
    return createElement(
      "p",
      { className: "status-message", role: "status", "aria-live": "polite" },
      "Resolving spoken text…"
    );
  }

  if (error !== null) {
    return createElement(
      "p",
      { className: "form-error", role: "alert" },
      error
    );
  }

  if (result === null) {
    return createElement(
      "p",
      { className: "status-message", role: "status" },
      "Run a preview to see the resolved spoken text."
    );
  }

  const resultChildren = [
    createElement("h3", { key: "resolved-title" }, "Resolved spoken text"),
    createElement("p", { key: "resolved-text" }, result.resolvedSpokenText)
  ];
  if (result.appliedTerms.length === 0) {
    resultChildren.push(
      createElement(
        "p",
        { key: "no-applied-terms" },
        "No terminology was applied."
      )
    );
  } else {
    resultChildren.push(
      createElement("h3", { key: "applied-title" }, "Applied terminology"),
      createElement(
        "ul",
        { key: "applied-list" },
        result.appliedTerms.map((term, index) =>
          createElement(
            "li",
            { key: `${term.termId}-${index}` },
            createElement("span", null, `${term.surface} → ${term.reading}`),
            " ",
            createElement("code", null, term.termId)
          )
        )
      )
    );
  }

  return createElement("div", { "aria-live": "polite" }, resultChildren);
}
