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

  assert.equal(firstHistory.length, 1);
  assert.equal(first.database.connection.open, true);

  const projectsPage = await first.app.inject({
    method: "GET",
    url: "/projects"
  });
  assert.equal(projectsPage.statusCode, 200);
  assert.match(projectsPage.headers["content-type"], /^text\/html/);

  const createResponse = await first.app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "Build verification project" }
  });
  assert.equal(createResponse.statusCode, 200);
  const createdProjectId = createResponse.json().data.metadata.id;

  const projectPage = await first.app.inject({
    method: "GET",
    url: `/projects/${createdProjectId}/brief`
  });
  assert.equal(projectPage.statusCode, 200);
  assert.match(projectPage.headers["content-type"], /^text\/html/);

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
