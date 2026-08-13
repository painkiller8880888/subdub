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
      "読み上げ内容を確認しています…"
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
      "プレビューを実行すると、用語を反映した読み上げ内容を確認できます。"
    );
  }

  const resultChildren = [
    createElement(
      "h3",
      { key: "resolved-title" },
      "用語を反映した読み上げ内容"
    ),
    createElement("p", { key: "resolved-text" }, result.resolvedSpokenText)
  ];
  if (result.appliedTerms.length === 0) {
    resultChildren.push(
      createElement(
        "p",
        { key: "no-applied-terms" },
        "適用された用語はありません。"
      )
    );
  } else {
    resultChildren.push(
      createElement("h3", { key: "applied-title" }, "適用した用語"),
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
