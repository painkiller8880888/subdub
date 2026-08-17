import { spawn } from "node:child_process";

import {
  packageManagerArgs,
  packageManagerCommand,
  stopChildProcess
} from "./process-utils.mjs";
import { createVoicevoxEngineManager } from "./voicevox-engine.mjs";

const children = [];
const shutdownController = new AbortController();
const voicevoxEngine = createVoicevoxEngineManager();

let shuttingDown = false;
let shutdownPromise;

function shutdown(exitCode) {
  if (shutdownPromise !== undefined) {
    return shutdownPromise;
  }

  shuttingDown = true;
  shutdownController.abort();
  shutdownPromise = (async () => {
    await Promise.all(children.map((child) => stopChildProcess(child)));
    await voicevoxEngine.stop();
    process.exit(exitCode);
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

await voicevoxEngine.start({ signal: shutdownController.signal });
if (shuttingDown) {
  await shutdownPromise;
}

if (!shuttingDown) {
  children.push(
    spawn(packageManagerCommand, [...packageManagerArgs, "dev:web"], {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
    }),
    spawn(packageManagerCommand, [...packageManagerArgs, "dev:api"], {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
    })
  );
}

for (const child of children) {
  child.once("error", () => void shutdown(1));
  child.once("exit", (code) => {
    if (!shuttingDown) {
      void shutdown(code ?? 1);
    }
  });
}
