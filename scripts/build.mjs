import { rm } from "node:fs/promises";

import { runPnpm } from "./process-utils.mjs";

const distRoot = new URL("../dist/", import.meta.url);

await rm(distRoot, {
  recursive: true,
  force: true
});

const commands = [
  ["exec", "vite", "build"],
  ["exec", "tsc", "-p", "tsconfig.api.build.json"]
];

for (const args of commands) {
  const exitCode = await runPnpm(args);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
