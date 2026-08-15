import type { AssetKind } from "../../schema/asset.js";

type LegacyAssetKind = Exclude<AssetKind, "bgm">;

export type AssetUploadLimits = {
  /** Maximum number of file parts in a single upload request. */
  readonly maxFileCount: number;
  /** Maximum number of parts (fields + files) in a single request. */
  readonly maxPartCount: number;
  /** Maximum number of non-file field parts in a single request. */
  readonly maxFieldCount: number;
  /** Maximum field name length in bytes. */
  readonly maxFieldNameLength: number;
  /** Maximum single field value length in bytes. */
  readonly maxFieldValueLength: number;
  /** Maximum client-provided filename length. Filenames are never used as paths. */
  readonly maxFileNameLength: number;
  /** Global file size cap enforced while streaming; the largest allowed kind is video. */
  readonly maxGlobalFileBytes: number;
  /**
   * Per-kind file size caps enforced at commit time. BGM is optional here so
   * pre-ED-02 custom limit objects remain compatible; omission uses the BGM
   * default below.
   */
  readonly perKindMaxBytes: Record<LegacyAssetKind, number> & {
    readonly bgm?: number;
  };
};

// Initial values. Rationale is documented in the P3-01 PR body.
// - maxFileCount 1: MVP registers exactly one file per request.
// - maxPartCount 64 / maxFieldCount 32: the fixed field set is ~7 (kind, title,
//   description, department, system, confidentiality, tagIds) plus one file;
//   headroom covers repeated tagIds fields.
// - maxFieldNameLength 64: longest field name is "confidentiality" (15 bytes).
// - maxFieldValueLength 8192: description may be long prose; other fields are short.
// - maxFileNameLength 255: never trusted as a path, capped only as abuse defense.
// - maxGlobalFileBytes 2 GiB: matches the largest per-kind cap (video) so the
//   streaming parser and per-kind caps stay consistent.
// - perKindMaxBytes: video 2 GiB (現場動画), bgm 200 MiB (BGM MP3),
//   photo 50 MiB (写真), document_scan 200 MiB (帳票スキャン),
//   sound_effect 200 MiB (効果音 WAV).
export const DEFAULT_ASSET_UPLOAD_LIMITS: AssetUploadLimits = {
  maxFileCount: 1,
  maxPartCount: 64,
  maxFieldCount: 32,
  maxFieldNameLength: 64,
  maxFieldValueLength: 8192,
  maxFileNameLength: 255,
  maxGlobalFileBytes: 2 * 1024 * 1024 * 1024,
  perKindMaxBytes: {
    video: 2 * 1024 * 1024 * 1024,
    bgm: 200 * 1024 * 1024,
    photo: 50 * 1024 * 1024,
    document_scan: 200 * 1024 * 1024,
    sound_effect: 200 * 1024 * 1024
  }
};
