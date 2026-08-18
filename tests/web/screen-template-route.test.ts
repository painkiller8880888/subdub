import { promises as fs } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { ScreenTemplateEditorPage } from "../../src/web/ScreenTemplateEditorPage";
import { ScreenTemplatesPage } from "../../src/web/ScreenTemplatesPage";

function renderWithRoute(
  element: ReactElement,
  path: string,
  entry: string
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(Routes, null, createElement(Route, { element, path }))
      )
    )
  );
}

describe("ScreenTemplate workspace routes", () => {
  it("renders the catalog loading state", () => {
    expect(
      renderWithRoute(
        createElement(ScreenTemplatesPage),
        "/screen-templates",
        "/screen-templates"
      )
    ).toContain("画面テンプレートを読み込んでいます");
  });

  it("renders the editor loading state through the template route", () => {
    expect(
      renderWithRoute(
        createElement(ScreenTemplateEditorPage),
        "/screen-templates/:templateId",
        "/screen-templates/screen-template-standard"
      )
    ).toContain("画面テンプレートを読み込んでいます");
  });

  it("declares the routes and persistent sidebar navigation", async () => {
    const [appSource, navigationSource] = await Promise.all([
      fs.readFile("src/web/App.tsx", "utf8"),
      fs.readFile("src/web/workspace-navigation.ts", "utf8")
    ]);
    expect(appSource).toContain('path="/screen-templates"');
    expect(appSource).toContain('path="/screen-templates/:templateId"');
    expect(navigationSource).toContain('id: "screen-templates"');
    expect(navigationSource).toContain('path: "/screen-templates"');
  });
});
