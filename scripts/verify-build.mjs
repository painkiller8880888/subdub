import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

const { initializeServer } = await import("../dist/api/server.js");
const workspaceRoot = await mkdtemp(
  path.join(tmpdir(), "subdub-build-verify-")
);

try {
  const first = await initializeServer({ workspaceRoot });
  const firstHistory = first.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();

  assert.equal(firstHistory.length, 1);
  assert.equal(first.database.connection.open, true);
  await first.app.close();
  assert.equal(first.database.connection.open, false);

  const second = await initializeServer({ workspaceRoot });
  const secondHistory = second.database.connection
    .prepare("SELECT hash, created_at FROM __drizzle_migrations")
    .all();
  assert.deepEqual(secondHistory, firstHistory);
  await second.app.close();
  assert.equal(second.database.connection.open, false);

  console.log("build migration resolution verified");
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
