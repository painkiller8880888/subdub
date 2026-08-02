import { spawn } from "node:child_process";

export const packageManagerCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";
export const packageManagerArgs = ["pnpm@11.17.0"];

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
