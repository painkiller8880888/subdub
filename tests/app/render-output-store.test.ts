import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RenderOutputStore } from "../../src/app/rendering/render-output-store.js";
import { RENDER_JOB_ERROR_CODE } from "../../src/app/rendering/render-job-errors.js";

const projectId = "output-project";
let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot !== undefined) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

async function createStore(): Promise<RenderOutputStore> {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "subdub-output-"));
  await fs.mkdir(path.join(temporaryRoot, "projects", projectId), {
    recursive: true
  });
  return new RenderOutputStore({ workspaceRoot: temporaryRoot });
}

describe("RenderOutputStore preview targets", () => {
  it("maps preview presets to a project-scoped previews directory", async () => {
    const store = await createStore();

    for (const preset of ["sd", "hd", "fhd"] as const) {
      const target = await store.prepare(projectId, "mp4", `run-${preset}`, {
        kind: "preview",
        previewPreset: preset
      });
      expect(target.outputPath).toBe(
        `output/previews/run-${preset}-${preset}.mp4`
      );
      expect(target.finalPath).toBe(
        path.join(
          temporaryRoot as string,
          "projects",
          projectId,
          "output",
          "previews",
          `run-${preset}-${preset}.mp4`
        )
      );
      expect(target.temporaryPath).toContain(
        path.join("output", "previews", `.${`run-${preset}`}-${preset}.tmp.mp4`)
      );
    }
  });

  it("promotes a preview without touching the production output path", async () => {
    const store = await createStore();
    const target = await store.prepare(projectId, "mp4", "preview-run", {
      kind: "preview",
      previewPreset: "hd"
    });
    await fs.writeFile(target.temporaryPath, "preview-bytes", "utf8");

    const promotion = await store.promote(target);
    expect(promotion.outputPath).toBe("output/previews/preview-run-hd.mp4");
    await expect(fs.readFile(target.finalPath, "utf8")).resolves.toBe(
      "preview-bytes"
    );
    await expect(
      fs.stat(
        path.join(
          temporaryRoot as string,
          "projects",
          projectId,
          "output",
          "render-preview-run.mp4"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid presets and preview thumbnails", async () => {
    const store = await createStore();

    await expect(
      store.prepare(projectId, "mp4", "run-invalid", {
        kind: "preview",
        previewPreset: "4k" as never
      })
    ).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.previewPresetInvalid
    });
    await expect(
      store.prepare(projectId, "thumbnail", "run-invalid", {
        kind: "preview",
        previewPreset: "sd"
      })
    ).rejects.toMatchObject({ code: RENDER_JOB_ERROR_CODE.previewKindInvalid });
  });
});
