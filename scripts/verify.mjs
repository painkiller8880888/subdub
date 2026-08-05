import { runPnpm } from "./process-utils.mjs";

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
