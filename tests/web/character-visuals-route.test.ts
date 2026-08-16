import { promises as fs } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { CharacterVisualsPage } from "../../src/web/CharacterVisualsPage";

describe("character visual management route", () => {
  it("renders the character visual page through the workspace route", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ["/character-visuals"] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              element: createElement(CharacterVisualsPage),
              path: "/character-visuals"
            })
          )
        )
      )
    );

    expect(markup).toContain("キャラクタービジュアルを読み込んでいます");
  });

  it("keeps the existing project workflow route declarations", async () => {
    const appSource = await fs.readFile("src/web/App.tsx", "utf8");

    expect(appSource).toContain('path="/projects/:projectId/script"');
    expect(appSource).toContain('path="/projects/:projectId/edit"');
    expect(appSource).toContain('path="/projects/:projectId/characters"');
    expect(appSource).toContain('path="/terminology"');
    expect(appSource).toContain('path="/ai-runs"');
  });
});
