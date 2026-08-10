import { randomUUID } from "node:crypto";

import {
  voiceGenerateRequestSchema,
  type VoiceGenerationAccepted,
  type VoiceGenerationJobSummary,
  type VoiceGenerationStatusData,
  type VoiceLineGenerationStatus
} from "../../schema/api.js";
import {
  idSchema,
  type Character,
  type ScriptLine,
  type VideoProject
} from "../../schema/index.js";
import {
  VoicevoxAdapterError,
  VoicevoxResolutionError
} from "../../voicevox/errors.js";
import {
  resolveVoicevoxSpeaker,
  VoicevoxClient
} from "../../voicevox/index.js";
import type {
  VoicevoxResolvedSpeaker,
  VoicevoxSpeaker
} from "../../voicevox/schemas.js";
import {
  VoicevoxAudioService,
  type GenerateVoicevoxAudioInput
} from "./audio-service.js";
import {
  VoicevoxAudioStore,
  VoicevoxAudioStoreError,
  type VoicevoxAudioStoreFileSystem
} from "./audio-store.js";
import {
  type VoicevoxAdjustmentFingerprintProvider,
  VoicevoxQueryService,
  VoicevoxQueryServiceError,
  type ResolvedVoicevoxQueryConditions
} from "./query-service.js";
import {
  VoicevoxQueryCacheError,
  type VoicevoxQueryCacheFileSystem
} from "./query-cache.js";
import type { TerminologyService } from "../terminology/terminology-service.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import { VoicevoxWavError } from "../../voicevox/wav.js";

export const VOICEVOX_GENERATION_ERROR_CODE = {
  unavailable: "VOICEVOX_UNAVAILABLE",
  lineNotFound: "VOICE_LINE_NOT_FOUND",
  dependencyRequired: "VOICEVOX_GENERATION_DEPENDENCY_REQUIRED"
} as const;

export type VoicevoxGenerationErrorCode =
  (typeof VOICEVOX_GENERATION_ERROR_CODE)[keyof typeof VOICEVOX_GENERATION_ERROR_CODE];

export class VoicevoxGenerationError extends Error {
  readonly code: VoicevoxGenerationErrorCode;
  readonly status: 404 | 503 | 500;

  constructor(
    code: VoicevoxGenerationErrorCode,
    status: 404 | 503 | 500,
    message: string
  ) {
    super(message);
    this.name = "VoicevoxGenerationError";
    this.code = code;
    this.status = status;
  }
}

type VoicevoxGenerationClientPort = Pick<
  VoicevoxClient,
  "getSpeakers" | "getVersion" | "getAudioQuery" | "synthesize"
>;

type VoicevoxProjectRepositoryPort = Pick<ProjectRepository, "read">;

type VoicevoxQueryConditionServicePort = Pick<
  VoicevoxQueryService,
  "resolveCurrent" | "prepare"
>;

type VoicevoxAudioGenerationServicePort = Pick<
  VoicevoxAudioService,
  "generate"
>;

export type VoicevoxGenerationStorePort = Pick<
  VoicevoxAudioStore,
  "readIndex" | "isEntryUsable" | "save"
>;

export type VoicevoxGenerationServiceOptions = {
  readonly repository: VoicevoxProjectRepositoryPort;
  readonly client?: VoicevoxGenerationClientPort;
  readonly terminologyService?: Pick<TerminologyService, "preview">;
  readonly queryService?: VoicevoxQueryConditionServicePort;
  readonly audioService?: VoicevoxAudioGenerationServicePort;
  readonly audioStore?: VoicevoxGenerationStorePort;
  readonly workspaceRoot?: string;
  readonly fileSystem?: Partial<VoicevoxAudioStoreFileSystem>;
  readonly queryCacheFileSystem?: Partial<VoicevoxQueryCacheFileSystem>;
  readonly adjustmentFingerprintProvider?: VoicevoxAdjustmentFingerprintProvider;
  readonly createId?: () => string;
};

type RuntimeLineState = {
  readonly runId: string;
  readonly state: "generating" | "failed";
  readonly cacheKey: string | null;
  readonly errorCode: string | null;
};

type JobRecord = {
  readonly runId: string;
  readonly projectId: string;
  readonly lineIds: readonly string[];
  status: "queued" | "running" | "succeeded" | "failed";
  readonly failedLineIds: Set<string>;
};

class VoicevoxJobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly lineStates = new Map<string, RuntimeLineState>();

  create(
    projectId: string,
    lineIds: readonly string[],
    runId: string
  ): JobRecord {
    const job: JobRecord = {
      runId,
      projectId,
      lineIds: [...lineIds],
      status: "queued",
      failedLineIds: new Set()
    };
    this.jobs.set(runId, job);
    return job;
  }

  start(job: JobRecord, targets: readonly GenerationTarget[]): void {
    job.status = "running";
    for (const target of targets) {
      this.lineStates.set(this.lineKey(job.projectId, target.line.id), {
        runId: job.runId,
        state: "generating",
        cacheKey: target.conditions.cacheKey,
        errorCode: null
      });
    }
  }

  markSucceeded(projectId: string, lineId: string, runId: string): void {
    const key = this.lineKey(projectId, lineId);
    const state = this.lineStates.get(key);
    if (state?.runId === runId) {
      this.lineStates.delete(key);
    }
  }

  markFailed(
    job: JobRecord,
    lineId: string,
    cacheKey: string | null,
    errorCode: string
  ): void {
    job.failedLineIds.add(lineId);
    this.lineStates.set(this.lineKey(job.projectId, lineId), {
      runId: job.runId,
      state: "failed",
      cacheKey,
      errorCode
    });
  }

  finish(job: JobRecord): void {
    job.status = job.failedLineIds.size === 0 ? "succeeded" : "failed";
  }

  failUnexpected(job: JobRecord, errorCode: string): void {
    for (const lineId of job.lineIds) {
      if (!job.failedLineIds.has(lineId)) {
        this.markFailed(job, lineId, null, errorCode);
      }
    }
    job.status = "failed";
  }

  getLineState(
    projectId: string,
    lineId: string
  ): RuntimeLineState | undefined {
    return this.lineStates.get(this.lineKey(projectId, lineId));
  }

  list(projectId: string): VoiceGenerationJobSummary[] {
    return [...this.jobs.values()]
      .filter((job) => job.projectId === projectId)
      .slice(-20)
      .map((job) => ({
        runId: job.runId,
        status: job.status,
        lineIds: [...job.lineIds],
        failedLineIds: [...job.failedLineIds]
      }));
  }

  private lineKey(projectId: string, lineId: string): string {
    return `${projectId}\u0000${lineId}`;
  }
}

type GenerationTarget = {
  readonly line: ScriptLine;
  readonly character: Character;
  readonly resolvedSpeaker: VoicevoxResolvedSpeaker;
  readonly sectionOrder: number;
  readonly lineOrder: number;
  readonly conditions: ResolvedVoicevoxQueryConditions;
};

type LineInspection = GenerationTarget & {
  readonly current: boolean;
};

function allLines(project: VideoProject): Array<{
  readonly line: ScriptLine;
  readonly sectionOrder: number;
  readonly lineOrder: number;
}> {
  return project.script.sections.flatMap((section, sectionIndex) =>
    section.lines.map((line, lineIndex) => ({
      line,
      sectionOrder: sectionIndex + 1,
      lineOrder: lineIndex + 1
    }))
  );
}

function safeFailureCode(error: unknown): string {
  if (error instanceof VoicevoxAdapterError) {
    return error.code;
  }
  if (error instanceof VoicevoxResolutionError) {
    return error.code;
  }
  if (error instanceof VoicevoxAudioStoreError) {
    return error.code;
  }
  if (error instanceof VoicevoxQueryCacheError) {
    return error.code;
  }
  if (error instanceof VoicevoxQueryServiceError) {
    return error.code;
  }
  if (error instanceof VoicevoxWavError) {
    return error.code;
  }
  return "VOICEVOX_GENERATION_FAILED";
}

function isVoicevoxUnavailable(error: unknown): boolean {
  return (
    error instanceof VoicevoxAdapterError ||
    error instanceof VoicevoxResolutionError ||
    (error instanceof VoicevoxGenerationError &&
      error.code === VOICEVOX_GENERATION_ERROR_CODE.unavailable)
  );
}

function unavailableError(): VoicevoxGenerationError {
  return new VoicevoxGenerationError(
    VOICEVOX_GENERATION_ERROR_CODE.unavailable,
    503,
    "VOICEVOX audio is unavailable."
  );
}

export class VoicevoxGenerationService {
  private readonly repository: VoicevoxProjectRepositoryPort;
  private readonly client: VoicevoxGenerationClientPort;
  private readonly queryService: VoicevoxQueryConditionServicePort;
  private readonly audioService: VoicevoxAudioGenerationServicePort;
  private readonly audioStore: VoicevoxGenerationStorePort;
  private readonly createId: () => string;
  private readonly jobs = new VoicevoxJobRegistry();

  constructor(options: VoicevoxGenerationServiceOptions) {
    this.repository = options.repository;
    const client = options.client ?? new VoicevoxClient();
    this.client = client;

    if (options.queryService !== undefined) {
      this.queryService = options.queryService;
    } else {
      if (
        options.terminologyService === undefined ||
        options.workspaceRoot === undefined
      ) {
        throw new VoicevoxGenerationError(
          VOICEVOX_GENERATION_ERROR_CODE.dependencyRequired,
          500,
          "VOICEVOX generation dependencies are not configured."
        );
      }
      this.queryService = new VoicevoxQueryService({
        client,
        terminologyService: options.terminologyService,
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.queryCacheFileSystem,
        adjustmentFingerprintProvider: options.adjustmentFingerprintProvider
      });
    }

    if (options.audioStore !== undefined) {
      this.audioStore = options.audioStore;
    } else {
      if (options.workspaceRoot === undefined) {
        throw new VoicevoxGenerationError(
          VOICEVOX_GENERATION_ERROR_CODE.dependencyRequired,
          500,
          "VOICEVOX generation dependencies are not configured."
        );
      }
      this.audioStore = new VoicevoxAudioStore({
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.fileSystem
      });
    }

    if (options.audioService !== undefined) {
      this.audioService = options.audioService;
    } else {
      this.audioService = new VoicevoxAudioService({
        queryService: this.queryService,
        client: this.client,
        audioStore: this.audioStore
      });
    }
    this.createId = options.createId ?? randomUUID;
  }

  async generate(
    projectId: unknown,
    input: unknown
  ): Promise<VoiceGenerationAccepted> {
    const safeProjectId = idSchema.parse(projectId);
    const request = voiceGenerateRequestSchema.parse(input);
    return this.enqueue(safeProjectId, request.lineIds);
  }

  async generateAll(projectId: unknown): Promise<VoiceGenerationAccepted> {
    const safeProjectId = idSchema.parse(projectId);
    const project = await this.repository.read(safeProjectId);
    return this.enqueue(
      safeProjectId,
      allLines(project).map(({ line }) => line.id)
    );
  }

  async getStatus(projectId: unknown): Promise<VoiceGenerationStatusData> {
    const safeProjectId = idSchema.parse(projectId);
    const project = await this.repository.read(safeProjectId);
    const jobs = this.jobs.list(safeProjectId);

    try {
      const inspections = await this.inspectProject(project);
      return {
        available: true,
        lines: inspections.map((inspection) =>
          this.lineStatus(safeProjectId, inspection)
        ),
        jobs
      };
    } catch (error) {
      if (!isVoicevoxUnavailable(error)) {
        throw error;
      }
      return {
        available: false,
        unavailableCode: VOICEVOX_GENERATION_ERROR_CODE.unavailable,
        lines: allLines(project).map(({ line }) =>
          this.fallbackLineStatus(safeProjectId, line.id)
        ),
        jobs
      };
    }
  }

  private async enqueue(
    projectId: string,
    requestedLineIds: readonly string[]
  ): Promise<VoiceGenerationAccepted> {
    const project = await this.repository.read(projectId);
    const projectLines = allLines(project);
    const requested = new Set(requestedLineIds);
    const missingLineId = [...requested].find(
      (lineId) => !projectLines.some(({ line }) => line.id === lineId)
    );
    if (missingLineId !== undefined) {
      throw new VoicevoxGenerationError(
        VOICEVOX_GENERATION_ERROR_CODE.lineNotFound,
        404,
        "The requested voice line does not exist."
      );
    }

    const inspections = await this.inspectProject(
      project,
      projectLines
        .filter(({ line }) => requested.has(line.id))
        .map(({ line }) => line.id)
    );
    const targets = inspections.filter(
      (inspection) =>
        !inspection.current &&
        this.jobs.getLineState(projectId, inspection.line.id)?.state !==
          "generating"
    );
    const runId = idSchema.parse(this.createId());
    const job = this.jobs.create(
      projectId,
      targets.map((target) => target.line.id),
      runId
    );
    void this.runJob(job, targets, projectId).catch(() => {
      this.jobs.failUnexpected(job, "VOICEVOX_GENERATION_FAILED");
    });

    return {
      runId,
      status: "queued",
      lineIds: targets.map((target) => target.line.id)
    };
  }

  private async runJob(
    job: JobRecord,
    targets: readonly GenerationTarget[],
    projectId: string
  ): Promise<void> {
    this.jobs.start(job, targets);
    for (const target of targets) {
      const input: GenerateVoicevoxAudioInput = {
        projectId,
        line: target.line,
        character: target.character,
        resolvedSpeaker: target.resolvedSpeaker,
        sectionOrder: target.sectionOrder,
        lineOrder: target.lineOrder
      };
      try {
        await this.audioService.generate(input);
        this.jobs.markSucceeded(projectId, target.line.id, job.runId);
      } catch (error) {
        this.jobs.markFailed(
          job,
          target.line.id,
          target.conditions.cacheKey,
          safeFailureCode(error)
        );
      }
    }
    this.jobs.finish(job);
  }

  private async inspectProject(
    project: VideoProject,
    lineIds?: readonly string[]
  ): Promise<LineInspection[]> {
    const index = await this.readIndex(project.metadata.id);
    const speakers = await this.resolveProjectSpeakers(project);
    const requested = lineIds === undefined ? undefined : new Set(lineIds);
    const inspections: LineInspection[] = [];

    for (const item of allLines(project)) {
      if (requested !== undefined && !requested.has(item.line.id)) {
        continue;
      }
      const character = project.characters.find(
        (candidate) => candidate.id === item.line.speakerId
      );
      if (character === undefined) {
        throw new VoicevoxGenerationError(
          VOICEVOX_GENERATION_ERROR_CODE.lineNotFound,
          404,
          "The voice line speaker does not exist."
        );
      }
      const resolvedSpeaker = speakers.get(character.id);
      if (resolvedSpeaker === undefined) {
        throw unavailableError();
      }
      const conditions = await this.queryService.resolveCurrent({
        projectId: project.metadata.id,
        line: item.line,
        character,
        resolvedSpeaker
      });
      const entry = index[item.line.id];
      const current =
        entry !== undefined &&
        entry.cacheKey === conditions.cacheKey &&
        (await this.audioStore.isEntryUsable(project.metadata.id, entry));
      inspections.push({
        line: item.line,
        character,
        resolvedSpeaker,
        sectionOrder: item.sectionOrder,
        lineOrder: item.lineOrder,
        conditions,
        current
      });
    }
    return inspections;
  }

  private async readIndex(projectId: string) {
    try {
      return await this.audioStore.readIndex(projectId);
    } catch (error) {
      if (
        error instanceof VoicevoxAudioStoreError &&
        error.code === "VOICEVOX_AUDIO_STORE_INDEX_INVALID"
      ) {
        return {};
      }
      throw error;
    }
  }

  private async resolveProjectSpeakers(
    project: VideoProject
  ): Promise<Map<string, VoicevoxResolvedSpeaker>> {
    let speakers: readonly VoicevoxSpeaker[];
    try {
      speakers = await this.client.getSpeakers();
    } catch (error) {
      if (isVoicevoxUnavailable(error)) {
        throw unavailableError();
      }
      throw error;
    }

    const resolved = new Map<string, VoicevoxResolvedSpeaker>();
    try {
      for (const character of project.characters) {
        resolved.set(
          character.id,
          resolveVoicevoxSpeaker(speakers, {
            speakerName: character.voicevox.speakerName,
            speakerUuid: character.voicevox.speakerUuid,
            styleName: character.voicevox.styleName
          })
        );
      }
    } catch (error) {
      if (error instanceof VoicevoxResolutionError) {
        throw unavailableError();
      }
      throw error;
    }
    return resolved;
  }

  private lineStatus(
    projectId: string,
    inspection: LineInspection
  ): VoiceLineGenerationStatus {
    const runtime = this.jobs.getLineState(projectId, inspection.line.id);
    if (runtime?.state === "generating") {
      return { lineId: inspection.line.id, status: "generating" };
    }
    if (
      runtime?.state === "failed" &&
      (runtime.cacheKey === null ||
        runtime.cacheKey === inspection.conditions.cacheKey)
    ) {
      return {
        lineId: inspection.line.id,
        status: "failed",
        errorCode: runtime.errorCode ?? "VOICEVOX_GENERATION_FAILED"
      };
    }
    return {
      lineId: inspection.line.id,
      status: inspection.current ? "current" : "stale"
    };
  }

  private fallbackLineStatus(
    projectId: string,
    lineId: string
  ): VoiceLineGenerationStatus {
    const runtime = this.jobs.getLineState(projectId, lineId);
    if (runtime?.state === "generating") {
      return { lineId, status: "generating" };
    }
    if (runtime?.state === "failed") {
      return {
        lineId,
        status: "failed",
        errorCode: runtime.errorCode ?? "VOICEVOX_GENERATION_FAILED"
      };
    }
    return { lineId, status: "stale" };
  }
}

export function createVoicevoxGenerationService(
  options: VoicevoxGenerationServiceOptions
): VoicevoxGenerationService {
  return new VoicevoxGenerationService(options);
}
