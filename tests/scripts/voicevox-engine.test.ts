import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VOICEVOX_ENGINE_URL,
  checkVoicevoxEngineReady,
  createVoicevoxEngineManager,
  getVoicevoxRunPath
} from "../../scripts/voicevox-engine.mjs";

class FakeChild extends EventEmitter {
  readonly pid: number;
  readonly kill = vi.fn(() => {
    this.emit("exit", null, "SIGTERM");
    return true;
  });

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function readyFetch() {
  return vi.fn(async (input: string | URL) => voicevoxResponse(input));
}

function voicevoxResponse(input: string | URL) {
  if (String(input).endsWith("/version")) {
    return new Response(JSON.stringify("0.15.0"), { status: 200 });
  }

  return new Response(
    JSON.stringify([
      {
        name: "四国めたん",
        speaker_uuid: "metan-fixture",
        styles: [{ name: "ノーマル", id: 2 }]
      }
    ]),
    { status: 200 }
  );
}

function unreachableFetch() {
  return vi.fn(async () => {
    throw new Error("connection refused");
  });
}

function managerOptions(overrides: Record<string, unknown> = {}) {
  return {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" },
    fileExists: async () => true,
    readinessTimeoutMs: 100,
    pollIntervalMs: 1,
    requestTimeoutMs: 10,
    log: vi.fn(),
    ...overrides
  };
}

describe("VOICEVOX engine lifecycle", () => {
  it("uses the standard run.exe path only on Windows", () => {
    expect(
      getVoicevoxRunPath(
        { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" },
        "win32"
      )
    ).toBe(
      "C:\\Users\\fixture\\AppData\\Local\\Programs\\VOICEVOX\\vv-engine\\run.exe"
    );
    expect(getVoicevoxRunPath({}, "linux")).toBeNull();
  });

  it("requires both valid VOICEVOX readiness endpoints", async () => {
    const fetch = readyFetch();

    await expect(
      checkVoicevoxEngineReady(DEFAULT_VOICEVOX_ENGINE_URL, {
        fetchImpl: fetch
      })
    ).resolves.toEqual({ ready: true, reason: "ready" });

    const collision = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await expect(
      checkVoicevoxEngineReady(DEFAULT_VOICEVOX_ENGINE_URL, {
        fetchImpl: collision
      })
    ).resolves.toEqual({ ready: false, reason: "port-occupied" });
  });

  it("reuses an already ready ENGINE without spawning or cleaning up", async () => {
    const spawn = vi.fn();
    const terminateProcess = vi.fn(async () => {});
    const manager = createVoicevoxEngineManager(
      managerOptions({
        fetchImpl: readyFetch(),
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "existing",
      managedBySubdub: false
    });
    await manager.stop();

    expect(spawn).not.toHaveBeenCalled();
    expect(terminateProcess).not.toHaveBeenCalled();
  });

  it("starts in GPU mode and cleans up only the owned process", async () => {
    const child = new FakeChild(4101);
    const spawn = vi.fn(() => child);
    const terminateProcess = vi.fn(async (ownedChild: FakeChild) => {
      ownedChild.emit("exit", null, "SIGTERM");
    });
    let fetchCount = 0;
    const fetch = vi.fn(async (input: string | URL) => {
      fetchCount += 1;
      if (fetchCount <= 2) {
        throw new Error("connection refused");
      }

      return voicevoxResponse(input);
    });
    const manager = createVoicevoxEngineManager(
      managerOptions({
        fetchImpl: fetch,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    const result = await manager.start();

    expect(result).toMatchObject({
      status: "started(gpu)",
      managedBySubdub: true
    });
    expect(spawn).toHaveBeenCalledWith(
      "C:\\Users\\fixture\\AppData\\Local\\Programs\\VOICEVOX\\vv-engine\\run.exe",
      ["--host", "127.0.0.1", "--port", "50021", "--use_gpu"],
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
        shell: false
      })
    );

    await manager.stop();
    expect(terminateProcess).toHaveBeenCalledWith(child);
  });

  it("falls back once from GPU to CPU when the GPU process exits", async () => {
    const modes: string[] = [];
    const children = [new FakeChild(4201), new FakeChild(4202)];
    const spawn = vi.fn((_path: string, args: string[]) => {
      const child = children[modes.length];
      if (child === undefined) {
        throw new Error("unexpected extra spawn");
      }

      modes.push(args.at(-1) === "--use_gpu" ? "gpu" : "cpu");
      if (modes.at(-1) === "gpu") {
        setTimeout(() => {
          child.emit("exit", 1, null);
        }, 0);
      }
      return child;
    });
    const terminateProcess = vi.fn(async () => {});
    const fetch = vi.fn(async (input: string | URL) => {
      if (modes.includes("cpu")) {
        return voicevoxResponse(input);
      }

      throw new Error("not ready yet");
    });
    const manager = createVoicevoxEngineManager(
      managerOptions({ spawnImpl: spawn, fetchImpl: fetch, terminateProcess })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "started(cpu)",
      managedBySubdub: true
    });
    expect(modes).toEqual(["gpu", "cpu"]);

    await manager.stop();
    expect(terminateProcess).toHaveBeenCalledWith(children[1]);
  });

  it("does not clean up an external ENGINE that wins the startup race", async () => {
    const child = new FakeChild(4301);
    let gpuExited = false;
    const spawn = vi.fn(() => {
      setTimeout(() => {
        gpuExited = true;
        child.emit("exit", 1, null);
      }, 0);
      return child;
    });
    const fetch = vi.fn(async (input: string | URL) => {
      if (!gpuExited) {
        throw new Error("not ready yet");
      }

      return voicevoxResponse(input);
    });
    const terminateProcess = vi.fn(async () => {});
    const manager = createVoicevoxEngineManager(
      managerOptions({ spawnImpl: spawn, fetchImpl: fetch, terminateProcess })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "existing",
      managedBySubdub: false
    });
    await manager.stop();

    expect(terminateProcess).not.toHaveBeenCalled();
  });

  it("stops CPU fallback when another service captures the port after GPU failure", async () => {
    const child = new FakeChild(4351);
    const modes: string[] = [];
    const spawn = vi.fn((_path: string, args: string[]) => {
      modes.push(args.at(-1) === "--use_gpu" ? "gpu" : "cpu");
      setTimeout(() => child.emit("exit", 1, null), 0);
      return child;
    });
    let readinessCalls = 0;
    const readinessCheck = vi.fn(async () => {
      readinessCalls += 1;
      if (readinessCalls <= 2) {
        return { ready: false, reason: "unreachable" };
      }

      return { ready: false, reason: "port-occupied" };
    });
    const terminateProcess = vi.fn(async () => {});
    const manager = createVoicevoxEngineManager(
      managerOptions({
        readinessCheck,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "unavailable",
      reason: "port-occupied"
    });
    expect(modes).toEqual(["gpu"]);
    expect(terminateProcess).not.toHaveBeenCalled();
  });

  it("falls back to CPU when the owned GPU process stays alive but is not ready", async () => {
    const children = [new FakeChild(4361), new FakeChild(4362)];
    const modes: string[] = [];
    let gpuStopped = false;
    const spawn = vi.fn((_path: string, args: string[]) => {
      const child = children[modes.length];
      if (child === undefined) {
        throw new Error("unexpected extra spawn");
      }

      modes.push(args.at(-1) === "--use_gpu" ? "gpu" : "cpu");
      return child;
    });
    const readinessCheck = vi.fn(async () => {
      if (modes.includes("cpu")) {
        return { ready: true, reason: "ready" };
      }

      if (modes.includes("gpu") && !gpuStopped) {
        return { ready: false, reason: "port-occupied" };
      }

      return { ready: false, reason: "unreachable" };
    });
    const terminateProcess = vi.fn(async () => {
      gpuStopped = true;
    });
    const manager = createVoicevoxEngineManager(
      managerOptions({
        readinessCheck,
        readinessTimeoutMs: 5,
        pollIntervalMs: 1,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "started(cpu)",
      managedBySubdub: true
    });
    expect(modes).toEqual(["gpu", "cpu"]);
    expect(terminateProcess).toHaveBeenCalledWith(children[0]);

    await manager.stop();
    expect(terminateProcess).toHaveBeenCalledWith(children[1]);
  });

  it("does not spawn CPU when an external service still owns the port after GPU cleanup", async () => {
    const child = new FakeChild(4371);
    const modes: string[] = [];
    let externalServiceOwnsPort = false;
    const spawn = vi.fn((_path: string, args: string[]) => {
      modes.push(args.at(-1) === "--use_gpu" ? "gpu" : "cpu");
      if (modes.at(-1) === "cpu") {
        throw new Error("CPU fallback must not start");
      }
      return child;
    });
    const readinessCheck = vi.fn(async () => {
      if (externalServiceOwnsPort) {
        return { ready: false, reason: "port-occupied" };
      }

      if (modes.includes("gpu")) {
        return { ready: false, reason: "port-occupied" };
      }

      return { ready: false, reason: "unreachable" };
    });
    const terminateProcess = vi.fn(async () => {
      externalServiceOwnsPort = true;
    });
    const manager = createVoicevoxEngineManager(
      managerOptions({
        readinessCheck,
        readinessTimeoutMs: 5,
        pollIntervalMs: 1,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "unavailable",
      reason: "port-occupied"
    });
    expect(modes).toEqual(["gpu"]);
    expect(terminateProcess).toHaveBeenCalledWith(child);
  });

  it("reuses an external VOICEVOX ENGINE that appears after GPU cleanup", async () => {
    const child = new FakeChild(4381);
    const modes: string[] = [];
    let externalVoicevoxReady = false;
    const spawn = vi.fn((_path: string, args: string[]) => {
      modes.push(args.at(-1) === "--use_gpu" ? "gpu" : "cpu");
      if (modes.at(-1) === "cpu") {
        throw new Error("CPU fallback must not start");
      }
      return child;
    });
    const readinessCheck = vi.fn(async () => {
      if (externalVoicevoxReady) {
        return { ready: true, reason: "ready" };
      }

      if (modes.includes("gpu")) {
        return { ready: false, reason: "port-occupied" };
      }

      return { ready: false, reason: "unreachable" };
    });
    const terminateProcess = vi.fn(async () => {
      externalVoicevoxReady = true;
    });
    const manager = createVoicevoxEngineManager(
      managerOptions({
        readinessCheck,
        readinessTimeoutMs: 5,
        pollIntervalMs: 1,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "existing",
      managedBySubdub: false
    });
    expect(modes).toEqual(["gpu"]);
    expect(terminateProcess).toHaveBeenCalledWith(child);
  });

  it("does not spawn when port 50021 belongs to a non-VOICEVOX HTTP service", async () => {
    const spawn = vi.fn();
    const log = vi.fn();
    const manager = createVoicevoxEngineManager(
      managerOptions({
        fetchImpl: vi.fn(
          async () => new Response("not voicevox", { status: 200 })
        ),
        spawnImpl: spawn,
        log
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "unavailable",
      reason: "port-occupied"
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps the app start path non-blocking when run.exe is missing", async () => {
    const spawn = vi.fn();
    const manager = createVoicevoxEngineManager(
      managerOptions({
        fetchImpl: unreachableFetch(),
        fileExists: async () => false,
        spawnImpl: spawn
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "unavailable",
      reason: "run-exe-missing"
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("never manages a custom VOICEVOX_ENGINE_URL", async () => {
    const fetch = vi.fn();
    const spawn = vi.fn();
    const terminateProcess = vi.fn(async () => {});
    const manager = createVoicevoxEngineManager(
      managerOptions({
        engineUrl: "http://voicevox.example.test:50021",
        fetchImpl: fetch,
        spawnImpl: spawn,
        terminateProcess
      })
    );

    await expect(manager.start()).resolves.toMatchObject({
      status: "external",
      managedBySubdub: false
    });
    await manager.stop();

    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(terminateProcess).not.toHaveBeenCalled();
  });

  it("stops readiness polling when shutdown is requested", async () => {
    const child = new FakeChild(4401);
    const terminateProcess = vi.fn(async () => {});
    const manager = createVoicevoxEngineManager(
      managerOptions({
        fetchImpl: unreachableFetch(),
        spawnImpl: vi.fn(() => child),
        terminateProcess,
        readinessTimeoutMs: 10_000,
        pollIntervalMs: 1_000
      })
    );

    const startPromise = manager.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manager.stop();
    await expect(startPromise).resolves.toMatchObject({
      status: "unavailable",
      reason: "shutdown"
    });
    expect(terminateProcess).toHaveBeenCalledWith(child);
  });
});
