import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const { initializeServer } = await import("../dist/api/server.js");
const workspaceRoot = await mkdtemp(
  path.join(tmpdir(), "subdub-build-verify-")
);
const staticRoot = fileURLToPath(new URL("../dist/web/", import.meta.url));

try {
  const first = await initializeServer({ workspaceRoot, staticRoot });
  const firstHistory = first.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();

  assert.equal(firstHistory.length, 4);
  assert.equal(first.database.connection.open, true);

  const projectsPage = await first.app.inject({
    method: "GET",
    url: "/projects"
  });
  assert.equal(projectsPage.statusCode, 200);
  assert.match(projectsPage.headers["content-type"], /^text\/html/);

  const characterAsset = await first.app.inject({
    method: "GET",
    url: "/shared-assets/characters/character-mentor/stand/stand.png"
  });
  assert.equal(characterAsset.statusCode, 200);
  assert.match(characterAsset.headers["content-type"], /^image\/png/);

  const createResponse = await first.app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "Build verification project" }
  });
  assert.equal(createResponse.statusCode, 200);
  const created = createResponse.json();
  const createdProjectId = created.data.metadata.id;

  const projectPage = await first.app.inject({
    method: "GET",
    url: `/projects/${createdProjectId}/brief`
  });
  assert.equal(projectPage.statusCode, 200);
  assert.match(projectPage.headers["content-type"], /^text\/html/);

  const sourceSave = await first.app.inject({
    method: "PUT",
    url: `/api/projects/${createdProjectId}/source`,
    payload: {
      markdown: "# Build verification\n\nPersisted source",
      expectedRevision: created.revision
    }
  });
  assert.equal(sourceSave.statusCode, 200);
  const sourceSaved = sourceSave.json();

  const briefSave = await first.app.inject({
    method: "PUT",
    url: `/api/projects/${createdProjectId}/brief`,
    payload: {
      brief: {
        ...created.data.brief,
        audience: "Build verification audience"
      },
      expectedRevision: sourceSaved.revision
    }
  });
  assert.equal(briefSave.statusCode, 200);

  await first.app.close();
  assert.equal(first.database.connection.open, false);

  const second = await initializeServer({ workspaceRoot, staticRoot });
  const secondHistory = second.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();
  assert.deepEqual(secondHistory, firstHistory);

  const persistedProject = await second.app.inject({
    method: "GET",
    url: `/api/projects/${createdProjectId}`
  });
  assert.equal(persistedProject.statusCode, 200);
  assert.equal(
    persistedProject.json().data.brief.audience,
    "Build verification audience"
  );

  const persistedSource = await second.app.inject({
    method: "GET",
    url: `/api/projects/${createdProjectId}/source`
  });
  assert.equal(persistedSource.statusCode, 200);
  assert.equal(
    persistedSource.json().data.markdown,
    "# Build verification\n\nPersisted source"
  );

  const persistedProjectPage = await second.app.inject({
    method: "GET",
    url: `/projects/${createdProjectId}/brief`
  });
  assert.equal(persistedProjectPage.statusCode, 200);

  await second.app.close();
  assert.equal(second.database.connection.open, false);

  console.log("build migration resolution verified");
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
