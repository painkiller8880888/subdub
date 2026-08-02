import { runPnpm } from "./process-utils.mjs";

const projects = [
  ["tsconfig.web.json"],
  ["tsconfig.api.json"],
  ["tsconfig.test.json"]
];

for (const [project] of projects) {
  const exitCode = await runPnpm(["exec", "tsc", "-p", project, "--noEmit"]);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
