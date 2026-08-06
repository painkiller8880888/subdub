import { expect, it } from "vitest";

import viteConfig from "../../vite.config.js";

it("proxies every /api request through a single proxy entry", () => {
  expect(viteConfig.server?.proxy).toEqual({
    "/api": {
      target: "http://127.0.0.1:3000"
    }
  });
});
