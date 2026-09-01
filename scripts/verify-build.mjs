import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const { initializeServer } = await import("../dist/api/server.js");
const workspaceRoot = await mkdtemp(
  path.join(tmpdir(), "subdub-build-verify-")
);
const staticRoot = fileURLToPath(new URL("../dist/web/", import.meta.url));
const migrationJournal = JSON.parse(
  await readFile(
    new URL("../dist/db/migrations/meta/_journal.json", import.meta.url),
    "utf8"
  )
);
assert.ok(Array.isArray(migrationJournal.entries));
const expectedMigrationCount = migrationJournal.entries.length;

let first;
let second;

try {
  first = await initializeServer({ workspaceRoot, staticRoot });
  const firstHistory = first.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();

  assert.equal(firstHistory.length, expectedMigrationCount);
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
    url: `/projects/${createdProjectId}/script`
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
  assert.equal(sourceSaved.revision, 1);

  const currentProjectResponse = await first.app.inject({
    method: "GET",
    url: `/api/projects/${createdProjectId}`
  });
  assert.equal(currentProjectResponse.statusCode, 200);
  const currentProject = currentProjectResponse.json().data;
  assert.equal(currentProject.schemaVersion, "1.9.0");
  assert.equal(Object.hasOwn(currentProject, "source"), false);
  assert.equal(Object.hasOwn(currentProject, "brief"), false);
  assert.equal(Object.hasOwn(currentProject, "outline"), false);
  assert.deepEqual(
    currentProject.script.sections.map(({ name, enabled }) => ({
      name,
      enabled
    })),
    [
      { name: "導入", enabled: true },
      { name: "本編", enabled: true },
      { name: "締め", enabled: true }
    ]
  );

  await first.app.close();
  assert.equal(first.database.connection.open, false);
  first = undefined;

  second = await initializeServer({ workspaceRoot, staticRoot });
  const secondHistory = second.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();
  assert.deepEqual(secondHistory, firstHistory);

  const persistedProject = await second.app.inject({
    method: "GET",
    url: `/api/projects/${createdProjectId}`
  });
  assert.equal(persistedProject.statusCode, 200);
  assert.equal(persistedProject.json().data.schemaVersion, "1.9.0");
  assert.equal(Object.hasOwn(persistedProject.json().data, "source"), false);
  assert.equal(Object.hasOwn(persistedProject.json().data, "brief"), false);
  assert.equal(Object.hasOwn(persistedProject.json().data, "outline"), false);

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
    url: `/projects/${createdProjectId}/script`
  });
  assert.equal(persistedProjectPage.statusCode, 200);

  await second.app.close();
  assert.equal(second.database.connection.open, false);
  second = undefined;

  console.log("build V19 project resolution verified");
} finally {
  if (second !== undefined) {
    await second.app.close().catch(() => undefined);
  }
  if (first !== undefined) {
    await first.app.close().catch(() => undefined);
  }
  await rm(workspaceRoot, { recursive: true, force: true });
}
