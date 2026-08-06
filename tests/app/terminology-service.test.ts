import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeWorkspaceDatabase } from "../../src/db/initialize.js";
import {
  TerminologyDuplicateError,
  TerminologyNotFoundError
} from "../../src/app/terminology/terminology-errors.js";
import { TerminologyRepository } from "../../src/app/terminology/terminology-repository.js";
import { TerminologyService } from "../../src/app/terminology/terminology-service.js";

describe("terminology service and repository", () => {
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      workspaceRoots
        .splice(0)
        .map((workspaceRoot) =>
          fs.rm(workspaceRoot, { recursive: true, force: true })
        )
    );
  });

  async function makeService(
    options: {
      ids?: string[];
      dates?: string[];
    } = {}
  ) {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-terminology-service-")
    );
    workspaceRoots.push(workspaceRoot);
    const database = await initializeWorkspaceDatabase({ workspaceRoot });
    const ids = [...(options.ids ?? ["term-one", "term-two"])]
      .reverse()
      .map((value) => value);
    const dates = [
      ...(options.dates ?? [
        "2026-08-06T00:00:00.000Z",
        "2026-08-06T00:01:00.000Z",
        "2026-08-06T00:02:00.000Z",
        "2026-08-06T00:03:00.000Z"
      ])
    ].reverse();
    const service = new TerminologyService({
      repository: new TerminologyRepository(database.database),
      createId: () => ids.pop() ?? "term-fallback",
      now: () => new Date(dates.pop() ?? "2026-08-06T01:00:00.000Z")
    });
    return { database, service };
  }

  it("creates, reads, lists, and persists a term after reopening the database", async () => {
    const { database, service } = await makeService();
    const created = service.create({
      surface: " SubDub ",
      readingKatakana: "サブダブ",
      category: " system ",
      priority: 3,
      notes: "共有用語"
    });

    expect(created).toMatchObject({
      termId: "term-one",
      surface: "SubDub",
      normalizedSurface: "SubDub",
      category: "system",
      status: "active"
    });
    expect(service.get(created.termId)).toEqual(created);
    expect(service.list()).toEqual([created]);
    database.close();

    const reopened = await initializeWorkspaceDatabase({
      workspaceRoot: workspaceRoots[0]
    });
    const reopenedRepository = new TerminologyRepository(reopened.database);
    expect(reopenedRepository.findById(created.termId)).toEqual(created);
    reopened.close();
  });

  it("rejects active duplicates and reactivates inactive duplicates with the same ID", async () => {
    const { database, service } = await makeService();
    const created = service.create({
      surface: "e\u0301xample",
      readingKatakana: "サンプル",
      category: "other"
    });

    expect(() =>
      service.create({
        surface: "éxample",
        readingKatakana: "サンプル",
        category: "other"
      })
    ).toThrow(TerminologyDuplicateError);

    const inactive = service.deactivate(created.termId);
    const reactivated = service.create({
      surface: "  éxample ",
      readingKatakana: "エグザンプル",
      category: "product",
      priority: -4,
      notes: "再登録"
    });

    expect(inactive.status).toBe("inactive");
    expect(reactivated.termId).toBe(created.termId);
    expect(reactivated.createdAt).toBe(created.createdAt);
    expect(reactivated.updatedAt).not.toBe(inactive.updatedAt);
    expect(reactivated).toMatchObject({
      surface: "éxample",
      readingKatakana: "エグザンプル",
      category: "product",
      priority: -4,
      notes: "再登録",
      status: "active"
    });
    database.close();
  });

  it("keeps the original row unchanged when an edit collides", async () => {
    const { database, service } = await makeService({
      ids: ["term-alpha", "term-beta"]
    });
    const first = service.create({
      surface: "Alpha",
      readingKatakana: "アルファ",
      category: "other"
    });
    const second = service.create({
      surface: "Beta",
      readingKatakana: "ベータ",
      category: "other"
    });

    expect(() =>
      service.update(second.termId, {
        surface: first.surface,
        readingKatakana: "ベータ",
        category: "other",
        priority: 2,
        notes: "衝突"
      })
    ).toThrow(TerminologyDuplicateError);
    expect(service.get(second.termId)).toEqual(second);
    database.close();
  });

  it("supports idempotent status changes and reports missing IDs", async () => {
    const { database, service } = await makeService();
    const created = service.create({
      surface: "Status",
      readingKatakana: "ステータス",
      category: "system"
    });
    expect(service.deactivate(created.termId).status).toBe("inactive");
    const inactiveAgain = service.deactivate(created.termId);
    expect(inactiveAgain.status).toBe("inactive");
    expect(service.activate(created.termId).status).toBe("active");
    const activeAgain = service.activate(created.termId);
    expect(activeAgain.status).toBe("active");
    expect(() => service.get("missing-term")).toThrow(TerminologyNotFoundError);
    expect(() => service.deactivate("missing-term")).toThrow(
      TerminologyNotFoundError
    );
    database.close();
  });

  it("searches literal percent and underscore characters in deterministic order", async () => {
    const { database, service } = await makeService({
      ids: ["term-zeta", "term-alpha", "term-middle"]
    });
    service.create({
      surface: "A_%",
      readingKatakana: "ゼータ",
      category: "other"
    });
    service.create({
      surface: "A_%_second",
      readingKatakana: "アルファ",
      category: "other"
    });
    service.create({
      surface: "A-plain",
      readingKatakana: "ミドル",
      category: "other"
    });

    expect(service.list({ surface: "%" }).map((term) => term.surface)).toEqual([
      "A_%",
      "A_%_second"
    ]);
    expect(service.list().map((term) => term.termId)).toEqual([
      "term-middle",
      "term-zeta",
      "term-alpha"
    ]);
    database.close();
  });

  it("rolls back a transaction when a later operation fails", async () => {
    const { database, service } = await makeService();
    const created = service.create({
      surface: "Rollback",
      readingKatakana: "ロールバック",
      category: "other"
    });
    const repository = new TerminologyRepository(database.database);

    expect(() =>
      repository.transaction((transactionRepository) => {
        transactionRepository.update(created.termId, {
          surface: "Changed",
          normalizedSurface: "Changed",
          readingKatakana: created.readingKatakana,
          category: created.category,
          priority: created.priority,
          notes: "partial",
          status: created.status,
          updatedAt: "2026-08-06T02:00:00.000Z"
        });
        throw new Error("rollback test");
      })
    ).toThrow("rollback test");
    expect(service.get(created.termId)).toEqual(created);
    database.close();
  });
});
