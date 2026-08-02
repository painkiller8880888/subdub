import { spawn } from "node:child_process";

const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
const packageManagerArgs = ["pnpm@11.17.0"];
const children = [
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
];

let shuttingDown = false;

function stopChild(child) {
  if (child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.unref();
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    stopChild(child);
  }

  setTimeout(() => process.exit(exitCode), 500);
}

for (const child of children) {
  child.once("error", () => shutdown(1));
  child.once("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));
