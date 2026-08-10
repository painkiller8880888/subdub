import { randomUUID } from "node:crypto";

import {
  idSchema,
  type Character,
  type ScriptLine,
  type VideoProject
} from "../../schema/index.js";
import {
  voicevoxAdjustmentFileSchema,
  voicevoxAudioQuerySchema,
  type VoicevoxAdjustmentFile,
  type VoicevoxAudioQuery,
  type VoicevoxResolvedSpeaker
} from "../../voicevox/schemas.js";
import {
  resolveVoicevoxSpeaker,
  VoicevoxClient
} from "../../voicevox/index.js";
import {
  VoicevoxAdapterError,
  VoicevoxResolutionError
} from "../../voicevox/errors.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  VoicevoxAdjustmentStore,
  type VoicevoxAdjustmentStoreFileSystem
} from "./adjustment-store.js";
import {
  VoicevoxPreviewStore,
  type VoicevoxPreviewStoreFileSystem
} from "./preview-store.js";
import {
  VoicevoxQueryService,
  type PreparedVoicevoxQuery
} from "./query-service.js";
import type { TerminologyService } from "../terminology/terminology-service.js";

export const VOICEVOX_ADJUSTMENT_ERROR_CODE = {
  unavailable: "VOICEVOX_ADJUSTMENT_UNAVAILABLE",
  lineNotFound: "VOICEVOX_ADJUSTMENT_LINE_NOT_FOUND",
  baseStale: "VOICEVOX_ADJUSTMENT_BASE_STALE",
  previewNotFound: "VOICEVOX_ADJUSTMENT_PREVIEW_NOT_FOUND",
  dependencyRequired: "VOICEVOX_ADJUSTMENT_DEPENDENCY_REQUIRED"
} as const;

export type VoicevoxAdjustmentErrorCode =
  (typeof VOICEVOX_ADJUSTMENT_ERROR_CODE)[keyof typeof VOICEVOX_ADJUSTMENT_ERROR_CODE];

export class VoicevoxAdjustmentError extends Error {
  readonly code: VoicevoxAdjustmentErrorCode;
  readonly status: 404 | 409 | 500 | 503;

  constructor(
    code: VoicevoxAdjustmentErrorCode,
    status: 404 | 409 | 500 | 503,
    message: string
  ) {
    super(message);
    this.name = "VoicevoxAdjustmentError";
    this.code = code;
    this.status = status;
  }
}

type VoicevoxAdjustmentClientPort = Pick<
  VoicevoxClient,
  "getSpeakers" | "getVersion" | "getAudioQuery" | "synthesize"
>;

type VoicevoxProjectRepositoryPort = Pick<ProjectRepository, "read">;

type VoicevoxAdjustmentQueryServicePort = Pick<
  VoicevoxQueryService,
  "prepareUnadjusted"
>;

export type VoicevoxAdjustmentSnapshot = {
  readonly lineId: string;
  readonly status: "current" | "needs_review";
  readonly query: VoicevoxAudioQuery;
  readonly adjustment: VoicevoxAdjustmentFile | null;
  readonly currentBase: {
    readonly baseHash: string;
    readonly resolvedSpokenText: string;
    readonly speakerUuid: string;
    readonly styleName: string;
    readonly resolvedStyleId: number;
    readonly voicevoxEngineVersion: string;
  };
};

export type VoicevoxAdjustmentServiceOptions = {
  readonly repository: VoicevoxProjectRepositoryPort;
  readonly client?: VoicevoxAdjustmentClientPort;
  readonly terminologyService?: Pick<TerminologyService, "preview">;
  readonly queryService?: VoicevoxAdjustmentQueryServicePort;
  readonly adjustmentStore?: Pick<
    VoicevoxAdjustmentStore,
    "read" | "write" | "delete"
  >;
  readonly workspaceRoot?: string;
  readonly adjustmentFileSystem?: Partial<VoicevoxAdjustmentStoreFileSystem>;
  readonly previewStore?: Pick<VoicevoxPreviewStore, "write" | "read">;
  readonly previewFileSystem?: Partial<VoicevoxPreviewStoreFileSystem>;
  readonly createId?: () => string;
};

export type VoicevoxAdjustmentServicePort = Pick<
  VoicevoxAdjustmentService,
  "get" | "save" | "preview" | "readPreview" | "discard" | "resetAll"
>;

type LineContext = {
  readonly project: VideoProject;
  readonly line: ScriptLine;
  readonly character: Character;
  readonly resolvedSpeaker: VoicevoxResolvedSpeaker;
};

function allLineIds(project: VideoProject): string[] {
  return project.script.sections.flatMap((section) =>
    section.lines.map((line) => line.id)
  );
}

function lineNotFoundError(): VoicevoxAdjustmentError {
  return new VoicevoxAdjustmentError(
    VOICEVOX_ADJUSTMENT_ERROR_CODE.lineNotFound,
    404,
    "The requested voice line does not exist."
  );
}

function currentBase(prepared: PreparedVoicevoxQuery) {
  if (prepared.baseHash === undefined) {
    throw new VoicevoxAdjustmentError(
      VOICEVOX_ADJUSTMENT_ERROR_CODE.dependencyRequired,
      500,
      "VOICEVOX adjustment base information is unavailable."
    );
  }
  return {
    baseHash: prepared.baseHash,
    resolvedSpokenText: prepared.resolvedSpokenText,
    speakerUuid: prepared.resolvedSpeaker.speakerUuid,
    styleName: prepared.resolvedSpeaker.styleName,
    resolvedStyleId: prepared.resolvedSpeaker.resolvedStyleId,
    voicevoxEngineVersion: prepared.voicevoxEngineVersion
  };
}

function sameBase(
  adjustment: VoicevoxAdjustmentFile,
  base: ReturnType<typeof currentBase>
): boolean {
  return (
    adjustment.base.baseHash === base.baseHash &&
    adjustment.base.resolvedSpokenText === base.resolvedSpokenText &&
    adjustment.base.speakerUuid === base.speakerUuid &&
    adjustment.base.styleName === base.styleName &&
    adjustment.base.resolvedStyleId === base.resolvedStyleId &&
    adjustment.base.voicevoxEngineVersion === base.voicevoxEngineVersion
  );
}

export class VoicevoxAdjustmentService {
  private readonly repository: VoicevoxProjectRepositoryPort;
  private readonly client: VoicevoxAdjustmentClientPort;
  private readonly queryService: VoicevoxAdjustmentQueryServicePort;
  private readonly adjustmentStore: Pick<
    VoicevoxAdjustmentStore,
    "read" | "write" | "delete"
  >;
  private readonly previewStore: Pick<VoicevoxPreviewStore, "write" | "read">;
  private readonly createId: () => string;

  constructor(options: VoicevoxAdjustmentServiceOptions) {
    this.repository = options.repository;
    this.client = options.client ?? new VoicevoxClient();
    this.createId = options.createId ?? randomUUID;

    if (options.adjustmentStore !== undefined) {
      this.adjustmentStore = options.adjustmentStore;
    } else if (options.workspaceRoot !== undefined) {
      this.adjustmentStore = new VoicevoxAdjustmentStore({
        workspaceRoot: options.workspaceRoot,
        fileSystem: options.adjustmentFileSystem
      });
    } else {
      throw new VoicevoxAdjustmentError(
        VOICEVOX_ADJUSTMENT_ERROR_CODE.dependencyRequired,
        500,
        "VOICEVOX adjustment storage is not configured."
      );
    }

    if (options.queryService !== undefined) {
      this.queryService = options.queryService;
    } else if (
      options.workspaceRoot !== undefined &&
      options.terminologyService !== undefined
    ) {
      this.queryService = new VoicevoxQueryService({
        client: this.client,
        terminologyService: options.terminologyService,
        workspaceRoot: options.workspaceRoot
      });
    } else {
      throw new VoicevoxAdjustmentError(
        VOICEVOX_ADJUSTMENT_ERROR_CODE.dependencyRequired,
        500,
        "VOICEVOX adjustment dependencies are not configured."
      );
    }

    this.previewStore =
      options.previewStore ??
      (options.workspaceRoot === undefined
        ? {
            write: async () => {
              throw new VoicevoxAdjustmentError(
                VOICEVOX_ADJUSTMENT_ERROR_CODE.dependencyRequired,
                500,
                "VOICEVOX preview storage is not configured."
              );
            },
            read: async () => null
          }
        : new VoicevoxPreviewStore({
            workspaceRoot: options.workspaceRoot,
            fileSystem: options.previewFileSystem
          }));
  }

  async get(
    projectId: unknown,
    lineId: unknown
  ): Promise<VoicevoxAdjustmentSnapshot> {
    const context = await this.resolveLineContext(projectId, lineId);
    const prepared = await this.queryService.prepareUnadjusted({
      projectId: context.project.metadata.id,
      line: context.line,
      character: context.character,
      resolvedSpeaker: context.resolvedSpeaker
    });
    return this.snapshot(context.line.id, prepared);
  }

  async save(
    projectId: unknown,
    lineId: unknown,
    candidate: unknown
  ): Promise<VoicevoxAdjustmentSnapshot> {
    const context = await this.resolveLineContext(projectId, lineId);
    const adjustment = voicevoxAdjustmentFileSchema.parse(candidate);
    const prepared = await this.queryService.prepareUnadjusted({
      projectId: context.project.metadata.id,
      line: context.line,
      character: context.character,
      resolvedSpeaker: context.resolvedSpeaker
    });
    const base = currentBase(prepared);
    if (adjustment.lineId !== context.line.id || !sameBase(adjustment, base)) {
      throw new VoicevoxAdjustmentError(
        VOICEVOX_ADJUSTMENT_ERROR_CODE.baseStale,
        409,
        "The voice adjustment is based on an older voice query."
      );
    }

    await this.adjustmentStore.write(
      { projectId: context.project.metadata.id, lineId: context.line.id },
      adjustment
    );
    return {
      ...this.snapshot(context.line.id, prepared),
      status: "current",
      adjustment
    };
  }

  async preview(
    projectId: unknown,
    lineId: unknown,
    query: unknown
  ): Promise<{ readonly previewId: string }> {
    const context = await this.resolveLineContext(projectId, lineId);
    const parsedQuery = voicevoxAudioQuerySchema.parse(query);
    const audioBytes = await this.client.synthesize(
      parsedQuery,
      context.resolvedSpeaker.resolvedStyleId
    );
    const previewId = idSchema.parse(this.createId());
    await this.previewStore.write(
      {
        projectId: context.project.metadata.id,
        lineId: context.line.id,
        previewId
      },
      audioBytes
    );
    return { previewId };
  }

  async readPreview(
    projectId: unknown,
    lineId: unknown,
    previewId: unknown
  ): Promise<Uint8Array> {
    const safeProjectId = idSchema.parse(projectId);
    const safeLineId = idSchema.parse(lineId);
    const safePreviewId = idSchema.parse(previewId);
    const bytes = await this.previewStore.read({
      projectId: safeProjectId,
      lineId: safeLineId,
      previewId: safePreviewId
    });
    if (bytes === null) {
      throw new VoicevoxAdjustmentError(
        VOICEVOX_ADJUSTMENT_ERROR_CODE.previewNotFound,
        404,
        "The requested voice preview does not exist."
      );
    }
    return bytes;
  }

  async discard(projectId: unknown, lineId: unknown): Promise<void> {
    const safeProjectId = idSchema.parse(projectId);
    const safeLineId = idSchema.parse(lineId);
    const project = await this.repository.read(safeProjectId);
    const lineExists = project.script.sections.some((section) =>
      section.lines.some((line) => line.id === safeLineId)
    );
    if (!lineExists) {
      throw lineNotFoundError();
    }
    await this.adjustmentStore.delete({
      projectId: safeProjectId,
      lineId: safeLineId
    });
  }

  async resetAll(projectId: unknown): Promise<{
    readonly projectId: string;
    readonly resetLineIds: readonly string[];
  }> {
    const safeProjectId = idSchema.parse(projectId);
    const project = await this.repository.read(safeProjectId);
    const resetLineIds = allLineIds(project);
    await Promise.all(
      resetLineIds.map((lineId) =>
        this.adjustmentStore.delete({ projectId: safeProjectId, lineId })
      )
    );
    return { projectId: safeProjectId, resetLineIds };
  }

  private async resolveLineContext(
    projectId: unknown,
    lineId: unknown
  ): Promise<LineContext> {
    const safeProjectId = idSchema.parse(projectId);
    const safeLineId = idSchema.parse(lineId);
    const project = await this.repository.read(safeProjectId);
    let line: ScriptLine | undefined;
    for (const section of project.script.sections) {
      line = section.lines.find((candidate) => candidate.id === safeLineId);
      if (line !== undefined) {
        break;
      }
    }
    if (line === undefined) {
      throw lineNotFoundError();
    }
    const character = project.characters.find(
      (candidate) => candidate.id === line?.speakerId
    );
    if (character === undefined) {
      throw lineNotFoundError();
    }

    let resolvedSpeaker: VoicevoxResolvedSpeaker;
    try {
      const speakers = await this.client.getSpeakers();
      resolvedSpeaker = resolveVoicevoxSpeaker(speakers, {
        speakerName: character.voicevox.speakerName,
        speakerUuid: character.voicevox.speakerUuid,
        styleName: character.voicevox.styleName
      });
    } catch (error) {
      if (
        error instanceof VoicevoxAdapterError ||
        error instanceof VoicevoxResolutionError
      ) {
        throw new VoicevoxAdjustmentError(
          VOICEVOX_ADJUSTMENT_ERROR_CODE.unavailable,
          503,
          "VOICEVOX audio is unavailable."
        );
      }
      throw error;
    }

    return { project, line, character, resolvedSpeaker };
  }

  private snapshot(
    lineId: string,
    prepared: PreparedVoicevoxQuery
  ): VoicevoxAdjustmentSnapshot {
    return {
      lineId,
      status:
        prepared.adjustmentStatus === "needs_review"
          ? "needs_review"
          : "current",
      query: prepared.query,
      adjustment: prepared.adjustment ?? null,
      currentBase: currentBase(prepared)
    };
  }
}
