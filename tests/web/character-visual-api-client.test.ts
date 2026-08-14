import { afterEach, describe, expect, it } from "vitest";

import {
  activateCharacterVisualVariant,
  createCharacterVisual,
  createCharacterVisualVariant,
  deactivateCharacterVisualVariant,
  fetchCharacterVisualFile,
  updateCharacterVisual,
  updateCharacterVisualVariant
} from "../../src/web/lib/api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const visual = {
  visualId: "visual-client",
  name: "Client visual",
  description: "",
  status: "active" as const,
  baseWidth: null,
  baseHeight: null,
  variants: [],
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z"
};

describe("character visual API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the JSON API for visual creation and metadata updates", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: visual });
    };

    await expect(
      createCharacterVisual({
        name: "  Client visual ",
        description: "  description ",
        status: "active"
      })
    ).resolves.toEqual(visual);
    await expect(
      updateCharacterVisual("visual/client", {
        name: "Updated visual",
        description: "Updated description",
        status: "inactive"
      })
    ).resolves.toEqual(visual);

    expect(calls.map((call) => call.input)).toEqual([
      "/api/character-visuals",
      "/api/character-visuals/visual%2Fclient"
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: "Client visual",
      description: "description",
      status: "active"
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      name: "Updated visual",
      description: "Updated description",
      status: "inactive"
    });
  });

  it("sends complete variant slots as multipart without overriding the boundary", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: visual });
    };
    const closed = new Blob(["closed"], { type: "image/png" });
    const open = new Blob(["open"], { type: "image/png" });

    await expect(
      createCharacterVisualVariant(
        "visual/client",
        { label: "Conversation", renderType: "mouth-pair", tags: ["talk"] },
        { closed, open }
      )
    ).resolves.toEqual(visual);
    await expect(
      updateCharacterVisualVariant(
        "visual/client",
        "variant/1",
        { label: "Conversation updated", renderType: "mouth-pair", tags: [] },
        { closed, open }
      )
    ).resolves.toEqual(visual);

    expect(calls.map((call) => call.input)).toEqual([
      "/api/character-visuals/visual%2Fclient/variants",
      "/api/character-visuals/visual%2Fclient/variants/variant%2F1"
    ]);
    expect(calls[0]?.init?.headers).toBeUndefined();
    const formData = calls[0]?.init?.body as FormData;
    expect(formData.get("label")).toBe("Conversation");
    expect(formData.get("renderType")).toBe("mouth-pair");
    expect(formData.getAll("tags")).toEqual(["talk"]);
    expect(formData.get("closed")).toBeInstanceOf(Blob);
    expect(formData.get("open")).toBeInstanceOf(Blob);
  });

  it("uses the status endpoints and safe managed file endpoint", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      calls.push(`${String(input)} ${init?.method ?? "GET"}`);
      if (init?.method === undefined) {
        return new Response("png", {
          status: 200,
          headers: { "content-type": "image/png" }
        });
      }
      return jsonResponse({ data: visual });
    };

    await expect(
      deactivateCharacterVisualVariant("visual/client", "variant/1")
    ).resolves.toEqual(visual);
    await expect(
      activateCharacterVisualVariant("visual/client", "variant/1")
    ).resolves.toEqual(visual);
    await expect(
      fetchCharacterVisualFile("visual/client", "variant/1", "closed")
    ).resolves.toBeInstanceOf(Blob);

    expect(calls).toEqual([
      "/api/character-visuals/visual%2Fclient/variants/variant%2F1/deactivate POST",
      "/api/character-visuals/visual%2Fclient/variants/variant%2F1/activate POST",
      "/api/character-visuals/visual%2Fclient/variant%2F1/closed GET"
    ]);
  });
});
