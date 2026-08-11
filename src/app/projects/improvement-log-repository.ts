import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import {
  aiGenerationCandidates,
  goldenExamples,
  improvementDecisions
} from "../../db/schema.js";
import {
  aiGenerationCandidateRecordSchema,
  approvedScriptBundleSchema,
  goldenExampleRecordSchema,
  goldenExampleKindSchema,
  improvementDecisionRecordSchema,
  improvementDecisionSchema,
  improvementReasonSchema,
  improvementTaskKindSchema,
  improvementTargetKindSchema,
  normalizeImprovementReason,
  type AiGenerationCandidateRecord,
  type GoldenExampleKind,
  type GoldenExampleRecord,
  type ImprovementDecision,
  type ImprovementDecisionRecord,
  type ImprovementTaskKind,
  type ImprovementTargetKind
} from "../../schema/improvement-log.js";
import {
  outlineSchema,
  visualAssignmentSchema
} from "../../schema/video-project.js";
import { visualSuggestionCandidateSchema } from "../../schema/visual-search-intent.js";
import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  sha256Schema
} from "../../schema/primitives.js";
import {
  IMPROVEMENT_LOG_ERROR_CODE,
  ImprovementLogError
} from "./improvement-log-errors.js";

export type GenerationCandidateInsert = {
  readonly candidateId: string;
  readonly generationRunId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly taskKind: ImprovementTaskKind;
  readonly targetKind: ImprovementTargetKind;
  readonly targetId: string;
  readonly candidateKey: string;
  readonly candidate: unknown;
  readonly modelId: string;
  readonly responseModel: string | null;
  readonly promptVersion: string;
  readonly createdAt: string;
};

export type CandidateLookup = {
  readonly projectId: string;
  readonly generationRunId: string;
  readonly candidateKey: string;
};

export type CandidateIdLookup = {
  readonly candidateId: string;
};

export type ImprovementDecisionInsert = {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly projectId: string;
  readonly projectRevisionBefore: number;
  readonly projectRevisionAfter: number;
  readonly decision: ImprovementDecision;
  readonly after: unknown | null;
  readonly reason: string | null | undefined;
  readonly createdAt: string;
};

export type GoldenExampleInsert = {
  readonly exampleId: string;
  readonly exampleKind: GoldenExampleKind;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly targetId: string;
  readonly sourceHash: string;
  readonly outlineHash: string | null;
  readonly payload: unknown;
  readonly generationRunId: string | null;
  readonly modelId: string | null;
  readonly promptVersion: string | null;
  readonly createdAt: string;
};

export type ImprovementLogRepositoryPort = Pick<
  ImprovementLogRepository,
  | "insertGenerationCandidate"
  | "insertGenerationCandidates"
  | "findGenerationCandidate"
  | "findGenerationCandidateById"
  | "findDecisionForCandidate"
  | "insertDecision"
  | "insertGoldenExample"
>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validationDetails(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): Array<{ path: Array<string | number>; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number"
    ),
    message: issue.message
  }));
}

function payloadError(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): ImprovementLogError {
  return new ImprovementLogError(
    IMPROVEMENT_LOG_ERROR_CODE.payloadInvalid,
    422,
    "The improvement log payload is invalid.",
    validationDetails(issues)
  );
}

function relationError(message: string): ImprovementLogError {
  return new ImprovementLogError(
    IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
    422,
    message
  );
}

function candidateNotFound(): ImprovementLogError {
  return new ImprovementLogError(
    IMPROVEMENT_LOG_ERROR_CODE.candidateNotFound,
    404,
    "The AI generation candidate does not exist."
  );
}

function databaseError(): ImprovementLogError {
  return new ImprovementLogError(
    IMPROVEMENT_LOG_ERROR_CODE.databaseFailed,
    500,
    "The improvement log could not be saved."
  );
}

function isConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /constraint|unique|foreign key/i.test(error.message)
  );
}

function stableJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw payloadError([{ path: [], message: "JSON numbers must be finite." }]);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) {
        throw payloadError([
          { path: [key], message: "undefined is not valid JSON." }
        ]);
      }
      result[key] = stableJsonValue(item);
    }
    return result;
  }
  throw payloadError([{ path: [], message: "The payload is not JSON." }]);
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(stableJsonValue(value));
  if (serialized === undefined) {
    throw payloadError([{ path: [], message: "The payload is not JSON." }]);
  }
  return serialized;
}

function parseStoredJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw databaseError();
  }
}

function validateCandidatePayload(
  taskKind: ImprovementTaskKind,
  candidate: unknown
): unknown {
  const result =
    taskKind === "outline_generation"
      ? outlineSchema.safeParse(candidate)
      : visualSuggestionCandidateSchema.safeParse(candidate);
  if (!result.success) {
    throw payloadError(result.error.issues);
  }
  return result.data;
}

function validateGoldenPayload(
  exampleKind: GoldenExampleKind,
  payload: unknown
): unknown {
  const result =
    exampleKind === "approved_outline"
      ? outlineSchema.safeParse(payload)
      : approvedScriptBundleSchema.safeParse(payload);
  if (!result.success) {
    throw payloadError(result.error.issues);
  }
  return result.data;
}

function validateDecisionAfter(
  taskKind: ImprovementTaskKind,
  decision: ImprovementDecision,
  after: unknown | null
): unknown | null {
  if (decision === "rejected") {
    if (after !== null) {
      throw relationError("A rejected decision cannot have an after payload.");
    }
    return null;
  }
  const result =
    taskKind === "outline_generation"
      ? outlineSchema.safeParse(after)
      : visualAssignmentSchema.safeParse(after);
  if (!result.success) {
    throw payloadError(result.error.issues);
  }
  return result.data;
}

function candidateRecordFromRow(
  row: typeof aiGenerationCandidates.$inferSelect
): AiGenerationCandidateRecord {
  return aiGenerationCandidateRecordSchema.parse({
    candidateId: row.candidateId,
    generationRunId: row.generationRunId,
    projectId: row.projectId,
    projectRevision: row.projectRevision,
    taskKind: row.taskKind,
    targetKind: row.targetKind,
    targetId: row.targetId,
    candidateKey: row.candidateKey,
    candidateJson: parseStoredJson(row.candidateJson),
    candidateChecksum: row.candidateChecksum,
    modelId: row.modelId,
    responseModel: row.responseModel,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt
  });
}

function decisionRecordFromRow(
  row: typeof improvementDecisions.$inferSelect
): ImprovementDecisionRecord {
  return improvementDecisionRecordSchema.parse({
    decisionId: row.decisionId,
    candidateId: row.candidateId,
    projectId: row.projectId,
    projectRevisionBefore: row.projectRevisionBefore,
    projectRevisionAfter: row.projectRevisionAfter,
    taskKind: row.taskKind,
    targetKind: row.targetKind,
    targetId: row.targetId,
    decision: row.decision,
    beforeJson: parseStoredJson(row.beforeJson),
    afterJson: row.afterJson === null ? null : parseStoredJson(row.afterJson),
    reason: row.reason,
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt
  });
}

function goldenRecordFromRow(
  row: typeof goldenExamples.$inferSelect
): GoldenExampleRecord {
  return goldenExampleRecordSchema.parse({
    exampleId: row.exampleId,
    exampleKind: row.exampleKind,
    projectId: row.projectId,
    projectRevision: row.projectRevision,
    targetId: row.targetId,
    sourceHash: row.sourceHash,
    outlineHash: row.outlineHash,
    payloadJson: parseStoredJson(row.payloadJson),
    payloadChecksum: row.payloadChecksum,
    generationRunId: row.generationRunId,
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt
  });
}

function parseCandidateInsert(input: GenerationCandidateInsert) {
  const candidateId = idSchema.parse(input.candidateId);
  const generationRunId = idSchema.parse(input.generationRunId);
  const projectId = idSchema.parse(input.projectId);
  const projectRevision = nonNegativeIntegerSchema.parse(input.projectRevision);
  const taskKind = improvementTaskKindSchema.parse(input.taskKind);
  const targetKind = improvementTargetKindSchema.parse(input.targetKind);
  const targetId = zString(input.targetId, "target ID", 512);
  const candidateKey = zString(input.candidateKey, "candidate key", 512);
  const modelId = zString(input.modelId, "model ID", 255);
  const responseModel =
    input.responseModel === null
      ? null
      : zString(input.responseModel, "response model", 255);
  const promptVersion = zString(input.promptVersion, "prompt version", 100);
  const createdAt = isoUtcDateTimeSchema.parse(input.createdAt);
  if (
    (taskKind === "outline_generation" && targetKind !== "outline") ||
    (taskKind === "visual_search_intent" && targetKind !== "visual_line_range")
  ) {
    throw relationError("The candidate task and target are inconsistent.");
  }
  const candidate = validateCandidatePayload(taskKind, input.candidate);
  const candidateJson = stableJson(candidate);
  return {
    candidateId,
    generationRunId,
    projectId,
    projectRevision,
    taskKind,
    targetKind,
    targetId,
    candidateKey,
    candidateJson,
    candidateChecksum: sha256(candidateJson),
    modelId,
    responseModel,
    promptVersion,
    createdAt
  };
}

function zString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw payloadError([{ path: [label], message: `${label} must not be blank.` }]);
  }
  if (value.length > max) {
    throw payloadError([{ path: [label], message: `${label} is too long.` }]);
  }
  return value;
}

export class ImprovementLogRepository {
  private readonly database: WorkspaceDatabase;

  constructor(database: WorkspaceDatabase) {
    this.database = database;
  }

  async insertGenerationCandidate(
    input: GenerationCandidateInsert
  ): Promise<AiGenerationCandidateRecord> {
    const inserted = await this.insertGenerationCandidates([input]);
    return inserted[0]!;
  }

  async insertGenerationCandidates(
    inputs: readonly GenerationCandidateInsert[]
  ): Promise<AiGenerationCandidateRecord[]> {
    if (inputs.length === 0) {
      return [];
    }
    const rows = inputs.map(parseCandidateInsert);
    const keys = new Set<string>();
    for (const row of rows) {
      const key = `${row.generationRunId}\u0000${row.candidateKey}`;
      if (keys.has(key)) {
        throw new ImprovementLogError(
          IMPROVEMENT_LOG_ERROR_CODE.candidateDuplicate,
          409,
          "The generation run already contains this candidate."
        );
      }
      keys.add(key);
    }
    try {
      this.database.transaction((transaction) => {
        for (const row of rows) {
          transaction.insert(aiGenerationCandidates).values(row).run();
        }
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new ImprovementLogError(
          IMPROVEMENT_LOG_ERROR_CODE.candidateDuplicate,
          409,
          "The generation run already contains this candidate."
        );
      }
      throw databaseError();
    }
    return Promise.all(
      rows.map((row) =>
        this.findGenerationCandidateById({ candidateId: row.candidateId })
      )
    ).then((records) => records.map((record) => record!));
  }

  async findGenerationCandidate(
    input: CandidateLookup
  ): Promise<AiGenerationCandidateRecord | undefined> {
    const projectId = idSchema.parse(input.projectId);
    const generationRunId = idSchema.parse(input.generationRunId);
    const candidateKey = zString(input.candidateKey, "candidate key", 512);
    try {
      const row = this.database
        .select()
        .from(aiGenerationCandidates)
        .where(
          and(
            eq(aiGenerationCandidates.projectId, projectId),
            eq(aiGenerationCandidates.generationRunId, generationRunId),
            eq(aiGenerationCandidates.candidateKey, candidateKey)
          )
        )
        .get();
      return row === undefined ? undefined : candidateRecordFromRow(row);
    } catch (error) {
      if (error instanceof ImprovementLogError) {
        throw error;
      }
      throw databaseError();
    }
  }

  async findGenerationCandidateById(
    input: CandidateIdLookup
  ): Promise<AiGenerationCandidateRecord | undefined> {
    const candidateId = idSchema.parse(input.candidateId);
    try {
      const row = this.database
        .select()
        .from(aiGenerationCandidates)
        .where(eq(aiGenerationCandidates.candidateId, candidateId))
        .get();
      return row === undefined ? undefined : candidateRecordFromRow(row);
    } catch (error) {
      if (error instanceof ImprovementLogError) {
        throw error;
      }
      throw databaseError();
    }
  }

  async findDecisionForCandidate(
    input: CandidateIdLookup & { readonly decision?: ImprovementDecision }
  ): Promise<ImprovementDecisionRecord | undefined> {
    const candidateId = idSchema.parse(input.candidateId);
    const decision =
      input.decision === undefined
        ? undefined
        : improvementDecisionSchema.parse(input.decision);
    try {
      const condition =
        decision === undefined
          ? eq(improvementDecisions.candidateId, candidateId)
          : and(
              eq(improvementDecisions.candidateId, candidateId),
              eq(improvementDecisions.decision, decision)
            );
      const row = this.database
        .select()
        .from(improvementDecisions)
        .where(condition)
        .get();
      return row === undefined ? undefined : decisionRecordFromRow(row);
    } catch (error) {
      if (error instanceof ImprovementLogError) {
        throw error;
      }
      throw databaseError();
    }
  }

  async insertDecision(
    input: ImprovementDecisionInsert
  ): Promise<ImprovementDecisionRecord> {
    const decisionId = idSchema.parse(input.decisionId);
    const candidateId = idSchema.parse(input.candidateId);
    const projectId = idSchema.parse(input.projectId);
    const projectRevisionBefore = nonNegativeIntegerSchema.parse(
      input.projectRevisionBefore
    );
    const projectRevisionAfter = nonNegativeIntegerSchema.parse(
      input.projectRevisionAfter
    );
    const decision = improvementDecisionSchema.parse(input.decision);
    const reasonValue = normalizeImprovementReason(input.reason);
    if (reasonValue !== null) {
      improvementReasonSchema.parse(reasonValue);
    }
    const createdAt = isoUtcDateTimeSchema.parse(input.createdAt);
    const candidate = await this.findGenerationCandidateById({ candidateId });
    if (candidate === undefined) {
      throw candidateNotFound();
    }
    if (candidate.projectId !== projectId) {
      throw relationError("The candidate belongs to a different project.");
    }
    if (projectRevisionAfter < projectRevisionBefore) {
      throw relationError("The decision revisions are not ordered.");
    }
    const after = validateDecisionAfter(candidate.taskKind, decision, input.after);
    const existing = await this.findDecisionForCandidate({ candidateId });
    if (existing !== undefined) {
      if (existing.decision === decision) {
        return existing;
      }
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.decisionConflict,
        409,
        "This candidate already has a different final decision."
      );
    }
    const row = {
      decisionId,
      candidateId,
      projectId,
      projectRevisionBefore,
      projectRevisionAfter,
      taskKind: candidate.taskKind,
      targetKind: candidate.targetKind,
      targetId: candidate.targetId,
      decision,
      beforeJson: stableJson(candidate.candidateJson),
      afterJson: after === null ? null : stableJson(after),
      reason: reasonValue,
      modelId: candidate.modelId,
      promptVersion: candidate.promptVersion,
      createdAt
    };
    try {
      this.database.insert(improvementDecisions).values(row).run();
    } catch (error) {
      if (isConstraintError(error)) {
        const retry = await this.findDecisionForCandidate({ candidateId });
        if (retry?.decision === decision) {
          return retry;
        }
        throw new ImprovementLogError(
          IMPROVEMENT_LOG_ERROR_CODE.decisionConflict,
          409,
          "This candidate already has a different final decision."
        );
      }
      throw databaseError();
    }
    const inserted = await this.findDecisionForCandidate({
      candidateId,
      decision
    });
    if (inserted === undefined) {
      throw databaseError();
    }
    return inserted;
  }

  async insertGoldenExample(
    input: GoldenExampleInsert
  ): Promise<GoldenExampleRecord> {
    const exampleId = idSchema.parse(input.exampleId);
    const exampleKind = goldenExampleKindSchema.parse(input.exampleKind);
    const projectId = idSchema.parse(input.projectId);
    const projectRevision = nonNegativeIntegerSchema.parse(
      input.projectRevision
    );
    const targetId = idSchema.parse(input.targetId);
    const sourceHash = sha256Schema.parse(input.sourceHash).toLowerCase();
    const outlineHash =
      input.outlineHash === null
        ? null
        : sha256Schema.parse(input.outlineHash).toLowerCase();
    const payload = validateGoldenPayload(exampleKind, input.payload);
    const payloadJson = stableJson(payload);
    const payloadChecksum = sha256(payloadJson);
    const generationRunId =
      input.generationRunId === null
        ? null
        : idSchema.parse(input.generationRunId);
    const modelId =
      input.modelId === null
        ? null
        : zString(input.modelId, "model ID", 255);
    const promptVersion =
      input.promptVersion === null
        ? null
        : zString(input.promptVersion, "prompt version", 100);
    if (
      (generationRunId === null || modelId === null || promptVersion === null) &&
      !(generationRunId === null && modelId === null && promptVersion === null)
    ) {
      throw relationError("Generation metadata must be complete or absent.");
    }
    const createdAt = isoUtcDateTimeSchema.parse(input.createdAt);
    try {
      const existing = this.database
        .select()
        .from(goldenExamples)
        .where(
          and(
            eq(goldenExamples.projectId, projectId),
            eq(goldenExamples.exampleKind, exampleKind),
            eq(goldenExamples.payloadChecksum, payloadChecksum)
          )
        )
        .get();
      if (existing !== undefined) {
        return goldenRecordFromRow(existing);
      }
      this.database
        .insert(goldenExamples)
        .values({
          exampleId,
          exampleKind,
          projectId,
          projectRevision,
          targetId,
          sourceHash,
          outlineHash,
          payloadJson,
          payloadChecksum,
          generationRunId,
          modelId,
          promptVersion,
          createdAt
        })
        .run();
    } catch (error) {
      if (error instanceof ImprovementLogError) {
        throw error;
      }
      if (isConstraintError(error)) {
        const existing = this.database
          .select()
          .from(goldenExamples)
          .where(
            and(
              eq(goldenExamples.projectId, projectId),
              eq(goldenExamples.exampleKind, exampleKind),
              eq(goldenExamples.payloadChecksum, payloadChecksum)
            )
          )
          .get();
        if (existing !== undefined) {
          return goldenRecordFromRow(existing);
        }
      }
      throw databaseError();
    }
    const inserted = this.database
      .select()
      .from(goldenExamples)
      .where(eq(goldenExamples.exampleId, exampleId))
      .get();
    if (inserted === undefined) {
      throw databaseError();
    }
    return goldenRecordFromRow(inserted);
  }

  async listGenerationCandidates(
    projectId: string
  ): Promise<AiGenerationCandidateRecord[]> {
    const safeProjectId = idSchema.parse(projectId);
    return this.database
      .select()
      .from(aiGenerationCandidates)
      .where(eq(aiGenerationCandidates.projectId, safeProjectId))
      .all()
      .map(candidateRecordFromRow);
  }

  async listDecisions(projectId: string): Promise<ImprovementDecisionRecord[]> {
    const safeProjectId = idSchema.parse(projectId);
    return this.database
      .select()
      .from(improvementDecisions)
      .where(eq(improvementDecisions.projectId, safeProjectId))
      .all()
      .map(decisionRecordFromRow);
  }

  async listGoldenExamples(projectId: string): Promise<GoldenExampleRecord[]> {
    const safeProjectId = idSchema.parse(projectId);
    return this.database
      .select()
      .from(goldenExamples)
      .where(eq(goldenExamples.projectId, safeProjectId))
      .all()
      .map(goldenRecordFromRow);
  }
}
