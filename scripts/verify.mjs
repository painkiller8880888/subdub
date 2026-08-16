import { spawnSync } from "node:child_process";

import { runPnpm } from "./process-utils.mjs";

const formatterTargets = [
  "src/app/assets/asset-processing-service.ts",
  "tests/app/asset-bgm.test.ts",
  "tests/app/asset-formats.test.ts",
  "tests/db/bgm-migration.test.ts"
];

const formatExitCode = await runPnpm([
  "exec",
  "prettier",
  "--write",
  ...formatterTargets
]);
if (formatExitCode !== 0) {
  process.exit(formatExitCode);
}
spawnSync("git", ["diff", "--", ...formatterTargets], { stdio: "inherit" });

for (const command of [
  "lint",
  "format:check",
  "typecheck",
  "test",
  "build",
  "verify:build",
  "verify:character-assets"
]) {
  const exitCode = await runPnpm([command]);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
