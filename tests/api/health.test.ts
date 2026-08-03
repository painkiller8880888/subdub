import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { SERVER_HOST } from "../../src/api/server.js";

describe("GET /api/health", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it("returns the minimal healthy response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toEqual({
      data: {
        status: "ok"
      }
    });
  });
});

describe("API listen configuration", () => {
  it("uses the loopback address only", () => {
    expect(SERVER_HOST).toBe("127.0.0.1");
  });
});
