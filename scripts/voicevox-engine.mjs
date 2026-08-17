import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { stopChildProcess } from "./process-utils.mjs";

export const VOICEVOX_ENGINE_URL_ENV = "VOICEVOX_ENGINE_URL";
export const VOICEVOX_ENGINE_HOST = "127.0.0.1";
export const VOICEVOX_ENGINE_PORT = 50021;
export const DEFAULT_VOICEVOX_ENGINE_URL = `http://${VOICEVOX_ENGINE_HOST}:${VOICEVOX_ENGINE_PORT}`;
export const VOICEVOX_ENGINE_READINESS_TIMEOUT_MS = 15_000;
export const VOICEVOX_ENGINE_POLL_INTERVAL_MS = 250;
export const VOICEVOX_ENGINE_REQUEST_TIMEOUT_MS = 1_000;

const VOICEVOX_ENGINE_RUN_DIRECTORY = ["Programs", "VOICEVOX", "vv-engine"];
const VOICEVOX_ENGINE_RUN_FILE = "run.exe";

function normalizeEngineUrl(engineUrl) {
  return engineUrl.trim().replace(/\/+$/, "");
}

export function getVoicevoxEngineUrl(env = process.env) {
  const value = env[VOICEVOX_ENGINE_URL_ENV];
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_VOICEVOX_ENGINE_URL;
  }

  return value.trim();
}

export function isDefaultVoicevoxEngineUrl(engineUrl) {
  try {
    const url = new URL(engineUrl);
    return (
      url.protocol === "http:" &&
      url.hostname === VOICEVOX_ENGINE_HOST &&
      url.port === String(VOICEVOX_ENGINE_PORT) &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function getVoicevoxRunPath(
  env = process.env,
  platform = process.platform
) {
  if (platform !== "win32") {
    return null;
  }

  const localAppData = env.LOCALAPPDATA;
  if (typeof localAppData !== "string" || localAppData.trim().length === 0) {
    return null;
  }

  return path.win32.join(
    localAppData.trim(),
    ...VOICEVOX_ENGINE_RUN_DIRECTORY,
    VOICEVOX_ENGINE_RUN_FILE
  );
}

function getEndpointUrl(engineUrl, endpoint) {
  return `${normalizeEngineUrl(engineUrl)}/${endpoint}`;
}

function isValidVersion(body) {
  return typeof body === "string" && body.trim().length > 0;
}

function isValidSpeakers(body) {
  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  return body.every(
    (speaker) =>
      speaker !== null &&
      typeof speaker === "object" &&
      typeof speaker.name === "string" &&
      speaker.name.trim().length > 0 &&
      typeof speaker.speaker_uuid === "string" &&
      speaker.speaker_uuid.trim().length > 0 &&
      Array.isArray(speaker.styles) &&
      speaker.styles.every(
        (style) =>
          style !== null &&
          typeof style === "object" &&
          typeof style.name === "string" &&
          style.name.trim().length > 0 &&
          Number.isInteger(style.id)
      )
  );
}

function createLinkedAbortController(signal) {
  const controller = new AbortController();
  if (signal === undefined) {
    return { controller, dispose: () => {} };
  }

  const abort = () => controller.abort();
  if (signal.aborted) {
    controller.abort();
    return { controller, dispose: () => {} };
  }

  signal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    dispose: () => signal.removeEventListener("abort", abort)
  };
}

async function requestJson(url, { fetchImpl, timeoutMs, signal }) {
  const linked = createLinkedAbortController(signal);
  const timeout = setTimeout(() => linked.controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: linked.controller.signal
    });

    if (!response.ok) {
      return { kind: "invalid" };
    }

    try {
      return { kind: "json", body: await response.json() };
    } catch {
      return { kind: "invalid" };
    }
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timeout);
    linked.dispose();
  }
}

export async function checkVoicevoxEngineReady(
  engineUrl,
  {
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = VOICEVOX_ENGINE_REQUEST_TIMEOUT_MS,
    signal
  } = {}
) {
  const [version, speakers] = await Promise.all([
    requestJson(getEndpointUrl(engineUrl, "version"), {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      signal
    }),
    requestJson(getEndpointUrl(engineUrl, "speakers"), {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      signal
    })
  ]);

  if (
    version.kind === "json" &&
    speakers.kind === "json" &&
    isValidVersion(version.body) &&
    isValidSpeakers(speakers.body)
  ) {
    return { ready: true, reason: "ready" };
  }

  if (version.kind !== "unreachable" || speakers.kind !== "unreachable") {
    return { ready: false, reason: "port-occupied" };
  }

  return { ready: false, reason: "unreachable" };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };

    timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) {
      finish();
    }
  });
}

export async function waitForVoicevoxReadiness(
  engineUrl,
  {
    readinessCheck = checkVoicevoxEngineReady,
    readinessTimeoutMs = VOICEVOX_ENGINE_READINESS_TIMEOUT_MS,
    pollIntervalMs = VOICEVOX_ENGINE_POLL_INTERVAL_MS,
    signal,
    ...readinessOptions
  } = {}
) {
  const deadline = Date.now() + Math.max(1, readinessTimeoutMs);

  while (!signal?.aborted) {
    const result = await readinessCheck(engineUrl, {
      ...readinessOptions,
      signal
    });
    if (result.ready) {
      return result;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { ready: false, reason: "timeout" };
    }

    await sleep(Math.min(Math.max(1, pollIntervalMs), remainingMs), signal);
  }

  return { ready: false, reason: "aborted" };
}

function observeChild(child) {
  let settled = false;
  let resolveExit;
  const onExit = (code, signal) => {
    if (settled) {
      return;
    }

    settled = true;
    resolveExit({ type: "exit", code, signal });
  };
  const onError = () => {
    if (settled) {
      return;
    }

    settled = true;
    resolveExit({ type: "error" });
  };
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
    child.once("exit", onExit);
    child.once("error", onError);
  });

  return {
    exitPromise,
    get settled() {
      return settled;
    },
    cancel() {
      child.removeListener?.("exit", onExit);
      child.removeListener?.("error", onError);
    }
  };
}

async function spawnEngineAttempt({
  mode,
  runPath,
  spawnImpl,
  readinessOptions,
  signal
}) {
  const args = [
    "--host",
    VOICEVOX_ENGINE_HOST,
    "--port",
    String(VOICEVOX_ENGINE_PORT),
    mode === "gpu" ? "--use_gpu" : "--no-use_gpu"
  ];

  let child;
  try {
    child = spawnImpl(runPath, args, {
      cwd: path.win32.dirname(runPath),
      stdio: "ignore",
      windowsHide: true,
      shell: false
    });
  } catch {
    return {
      ready: false,
      reason: "spawn-error",
      child: null,
      watcher: null,
      exited: true
    };
  }

  const watcher = observeChild(child);
  const readinessPromise = waitForVoicevoxReadiness(
    DEFAULT_VOICEVOX_ENGINE_URL,
    { ...readinessOptions, signal }
  ).then((result) => ({ type: "readiness", result }));
  const exitPromise = watcher.exitPromise.then((result) => ({
    type: "exit",
    result
  }));
  const outcome = await Promise.race([readinessPromise, exitPromise]);

  if (outcome.type === "readiness" && outcome.result.ready) {
    return {
      ready: true,
      reason: "ready",
      child,
      watcher,
      exited: watcher.settled,
      mode
    };
  }

  if (outcome.type === "readiness" && outcome.result.reason === "aborted") {
    return {
      ready: false,
      reason: "aborted",
      child,
      watcher,
      exited: watcher.settled,
      mode
    };
  }

  watcher.cancel();
  return {
    ready: false,
    reason:
      outcome.type === "exit" ? outcome.result.type : outcome.result.reason,
    child,
    watcher,
    exited: outcome.type === "exit" || watcher.settled,
    mode
  };
}

export function createVoicevoxEngineManager({
  env = process.env,
  platform = process.platform,
  engineUrl = getVoicevoxEngineUrl(env),
  fetchImpl = globalThis.fetch,
  fileExists = async (filePath) => {
    try {
      await access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  spawnImpl = spawn,
  terminateProcess = stopChildProcess,
  readinessCheck = checkVoicevoxEngineReady,
  readinessTimeoutMs = VOICEVOX_ENGINE_READINESS_TIMEOUT_MS,
  pollIntervalMs = VOICEVOX_ENGINE_POLL_INTERVAL_MS,
  requestTimeoutMs = VOICEVOX_ENGINE_REQUEST_TIMEOUT_MS,
  log = console.log
} = {}) {
  const runPath = getVoicevoxRunPath(env, platform);
  let startPromise;
  let operationController;
  let activeAttempt = null;
  let managedAttempt = null;
  let stopping = false;
  let result = { status: "idle", managedBySubdub: false, engineUrl };
  let statusReported = false;

  function reportStatus(status, reason) {
    if (statusReported) {
      return;
    }

    statusReported = true;
    const suffix = reason === undefined ? "" : ` (${reason})`;
    log(`VOICEVOX: ${status}${suffix}`);
  }

  function setResult(status, extra = {}) {
    result = {
      status,
      managedBySubdub: status === "started(gpu)" || status === "started(cpu)",
      engineUrl,
      ...extra
    };
    return result;
  }

  async function cleanupAttempt(attempt) {
    if (attempt === null || attempt.cleaned) {
      return;
    }

    attempt.cleaned = true;
    attempt.watcher?.cancel();
    if (!attempt.exited && attempt.child !== null) {
      await terminateProcess(attempt.child);
    }
  }

  function adoptManagedAttempt(attempt) {
    managedAttempt = attempt;
    attempt.watcher.exitPromise.then(() => {
      if (managedAttempt === attempt) {
        managedAttempt = null;
      }
    });
  }

  async function verifyAfterFailedAttempt() {
    if (stopping || operationController?.signal.aborted) {
      return { ready: false, reason: "aborted" };
    }

    return readinessCheck(DEFAULT_VOICEVOX_ENGINE_URL, {
      fetchImpl,
      requestTimeoutMs,
      signal: operationController?.signal
    });
  }

  async function runAttempt(mode) {
    const attempt = await spawnEngineAttempt({
      mode,
      runPath,
      spawnImpl,
      readinessOptions: {
        readinessCheck,
        fetchImpl,
        requestTimeoutMs,
        readinessTimeoutMs,
        pollIntervalMs
      },
      signal: operationController?.signal
    });
    activeAttempt = attempt;
    return attempt;
  }

  async function startInternal() {
    if (stopping || operationController?.signal.aborted) {
      return setResult("unavailable", { reason: "shutdown" });
    }

    if (!isDefaultVoicevoxEngineUrl(engineUrl)) {
      return setResult("external", { managedBySubdub: false });
    }

    if (platform !== "win32") {
      return setResult("unsupported", { managedBySubdub: false });
    }

    const initial = await readinessCheck(DEFAULT_VOICEVOX_ENGINE_URL, {
      fetchImpl,
      requestTimeoutMs,
      signal: operationController?.signal
    });
    if (initial.ready) {
      reportStatus("existing");
      return setResult("existing");
    }

    if (initial.reason === "port-occupied") {
      reportStatus("unavailable", "port 50021 is occupied by another service");
      return setResult("unavailable", { reason: initial.reason });
    }

    if (operationController?.signal.aborted) {
      return setResult("unavailable", { reason: "shutdown" });
    }

    if (runPath === null || !(await fileExists(runPath))) {
      reportStatus("unavailable", "VOICEVOX run.exe was not found");
      return setResult("unavailable", { reason: "run-exe-missing" });
    }

    const gpuAttempt = await runAttempt("gpu");
    activeAttempt = null;
    if (gpuAttempt.ready && !gpuAttempt.exited) {
      if (stopping || operationController?.signal.aborted) {
        await cleanupAttempt(gpuAttempt);
        return setResult("unavailable", { reason: "shutdown" });
      }

      adoptManagedAttempt(gpuAttempt);
      reportStatus("started(gpu)");
      return setResult("started(gpu)");
    }

    const afterGpu = await verifyAfterFailedAttempt();
    if (afterGpu.ready) {
      if (!gpuAttempt.exited && gpuAttempt.child !== null) {
        if (stopping || operationController?.signal.aborted) {
          await cleanupAttempt(gpuAttempt);
          return setResult("unavailable", { reason: "shutdown" });
        }

        adoptManagedAttempt(gpuAttempt);
        reportStatus("started(gpu)");
        return setResult("started(gpu)");
      }

      reportStatus("existing");
      return setResult("existing");
    }

    await cleanupAttempt(gpuAttempt);
    if (operationController?.signal.aborted) {
      return setResult("unavailable", { reason: "shutdown" });
    }

    const cpuAttempt = await runAttempt("cpu");
    activeAttempt = null;
    if (cpuAttempt.ready && !cpuAttempt.exited) {
      if (stopping || operationController?.signal.aborted) {
        await cleanupAttempt(cpuAttempt);
        return setResult("unavailable", { reason: "shutdown" });
      }

      adoptManagedAttempt(cpuAttempt);
      reportStatus("started(cpu)");
      return setResult("started(cpu)");
    }

    const afterCpu = await verifyAfterFailedAttempt();
    if (afterCpu.ready) {
      if (!cpuAttempt.exited && cpuAttempt.child !== null) {
        if (stopping || operationController?.signal.aborted) {
          await cleanupAttempt(cpuAttempt);
          return setResult("unavailable", { reason: "shutdown" });
        }

        adoptManagedAttempt(cpuAttempt);
        reportStatus("started(cpu)");
        return setResult("started(cpu)");
      }

      reportStatus("existing");
      return setResult("existing");
    }

    await cleanupAttempt(cpuAttempt);
    if (operationController?.signal.aborted) {
      return setResult("unavailable", { reason: "shutdown" });
    }

    reportStatus("unavailable", "VOICEVOX ENGINE did not become ready");
    return setResult("unavailable", { reason: "readiness-failed" });
  }

  async function start({ signal } = {}) {
    if (startPromise !== undefined) {
      return startPromise;
    }

    operationController = new AbortController();
    if (signal !== undefined) {
      if (signal.aborted) {
        operationController.abort();
      } else {
        signal.addEventListener("abort", () => operationController.abort(), {
          once: true
        });
      }
    }

    startPromise = startInternal();
    return startPromise;
  }

  async function stop() {
    stopping = true;
    operationController?.abort();
    await cleanupAttempt(activeAttempt);
    activeAttempt = null;

    const attempt = managedAttempt;
    managedAttempt = null;
    if (attempt !== null) {
      await cleanupAttempt(attempt);
    }

    if (startPromise !== undefined) {
      await startPromise;
    }

    const startedAttempt = managedAttempt;
    managedAttempt = null;
    if (startedAttempt !== null) {
      await cleanupAttempt(startedAttempt);
    }
  }

  return {
    start,
    stop,
    getState: () => result
  };
}
