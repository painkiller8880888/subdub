import { spawn } from "node:child_process";

export const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
export const packageManagerArgs = ["pnpm@11.22.0"];

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32",
      ...options
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

export function runPnpm(args, options = {}) {
  return run(packageManagerCommand, [...packageManagerArgs, ...args], options);
}

export function stopChildProcess(child) {
  if (child?.pid === undefined) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      let killer;
      try {
        killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true
        });
      } catch {
        finish();
        return;
      }

      killer.once("error", finish);
      killer.once("exit", finish);
    });
  }

  try {
    child.kill?.("SIGTERM");
  } catch {
    // The process may have exited between the status check and kill request.
  }
  return Promise.resolve();
}
