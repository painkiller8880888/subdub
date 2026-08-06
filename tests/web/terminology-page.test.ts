import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TerminologyStatusError } from "../../src/web/terminology-status-error.js";

describe("terminology page status errors", () => {
  it("renders status mutation failures as an alert", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminologyStatusError, {
        message: "状態を変更できませんでした。"
      })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("状態を変更できませんでした。");
    expect(
      renderToStaticMarkup(
        createElement(TerminologyStatusError, { message: null })
      )
    ).toBe("");
  });
});
