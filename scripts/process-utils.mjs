import { spawn } from "node:child_process";

export const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
export const packageManagerArgs = ["pnpm@11.22.0"];
export const CHILD_PROCESS_STOP_TIMEOUT_MS = 500;

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

export function stopChildProcess(
  child,
  {
    platform = process.platform,
    timeoutMs = CHILD_PROCESS_STOP_TIMEOUT_MS
  } = {}
) {
  if (child?.pid === undefined) {
    return Promise.resolve();
  }

  if (platform === "win32") {
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

  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.removeListener?.("exit", finish);
      child.removeListener?.("close", finish);
      resolve();
    };

    if (child.exitCode !== null && child.exitCode !== undefined) {
      finish();
      return;
    }

    if (child.signalCode !== null && child.signalCode !== undefined) {
      finish();
      return;
    }

    child.once?.("exit", finish);
    child.once?.("close", finish);
    timer = setTimeout(
      finish,
      Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : CHILD_PROCESS_STOP_TIMEOUT_MS
    );

    try {
      if (child.kill?.("SIGTERM") === false) {
        finish();
      }
    } catch {
      // The process may have exited between the status check and kill request.
      finish();
    }
  });
}
