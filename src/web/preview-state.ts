import type {
  ManifestCompileDiagnostic,
  ManifestPreviewBlocker,
  ManifestPreviewData,
  ManifestPreviewState
} from "../schema/api.js";
import type { RenderManifest } from "../schema/index.js";
import type { ManifestAssetUrlResolver } from "../remotion/asset-url";
import { createProjectManifestAssetUrlResolver } from "./preview-asset-url";

export type PreviewBlockerViewModel = {
  readonly blocker: ManifestPreviewBlocker;
  readonly message: string;
  readonly targetLabel: string;
  readonly href: string;
};

export type PreviewViewModel = {
  readonly stateLabel: string;
  readonly stateDescription: string;
  readonly previousSuccess: boolean;
  readonly canPlay: boolean;
  readonly blockers: readonly PreviewBlockerViewModel[];
};

export type PreviewPlayerProps = {
  readonly durationInFrames: number;
  readonly fps: number;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly inputProps: {
    readonly manifest: RenderManifest;
    readonly assetUrlResolver: ManifestAssetUrlResolver;
  };
};

export type PreviewCompileDiagnosticViewModel = {
  readonly diagnostic: ManifestCompileDiagnostic;
  readonly title: string;
  readonly target: string;
};

const compileDiagnosticTitles: Readonly<Record<string, string>> = {
  OUTLINE_NOT_APPROVED: "構成案が未承認です。",
  OUTLINE_SOURCE_HASH_MISMATCH:
    "元資料が更新されています。構成案を確認してください。",
  SCRIPT_OUTLINE_HASH_MISMATCH:
    "構成案と台本の対応が古くなっています。台本を確認してください。",
  SCRIPT_EMPTY: "台本にセリフがありません。",
  SCRIPT_SECTION_EMPTY: "セリフがないセクションがあります。",
  AUDIO_INDEX_ENTRY_MISSING: "セリフに必要な音声が未生成です。",
  AUDIO_INDEX_ENTRY_EXTRA: "削除済みまたは不明なセリフの音声が残っています。",
  AUDIO_ASSET_MISSING: "音声ファイルの素材情報が不足しています。",
  AUDIO_ASSET_CHECKSUM_MISMATCH: "音声ファイルが更新されています。",
  AUDIO_ASSET_KIND_MISMATCH: "音声素材の種類が正しくありません。",
  AUDIO_DURATION_MISMATCH: "音声の長さ情報が一致しません。",
  ASSET_METADATA_MISSING: "参照素材のメタデータが不足しています。",
  ASSET_KIND_MISMATCH: "参照素材の種類が正しくありません。",
  ASSET_CHECKSUM_MISMATCH: "参照素材が更新されています。",
  ASSET_DURATION_MISSING: "動画素材の長さ情報が不足しています。",
  ASSET_DURATION_INVALID: "動画素材の長さ情報が不正です。",
  ASSET_RANGE_INVALID: "素材の表示範囲が不正です。",
  ASSET_PAGE_COUNT_MISSING: "帳票素材のページ数情報が不足しています。",
  CHARACTER_VISUAL_BINDING_MISSING: "キャラクター素材のbindingが未設定です。",
  CHARACTER_VARIANT_UNSELECTED: "キャラクター素材のvariantが未選択です。",
  CHARACTER_VARIANT_MISSING:
    "選択されたキャラクターvariantがカタログにありません。",
  CHARACTER_VARIANT_CHARACTER_MISMATCH:
    "選択されたキャラクターvariantが別のビジュアルに属しています。",
  CHARACTER_VISUAL_INACTIVE: "参照先のキャラクタービジュアルが無効です。",
  CHARACTER_VARIANT_INACTIVE: "参照先のキャラクターvariantが無効です。",
  CHARACTER_VARIANT_FILE_SLOT_MISSING:
    "キャラクターvariantに必要な画像slotが不足しています。",
  CHARACTER_VARIANT_FILE_MISSING:
    "キャラクターvariantの画像ファイルが不足しています。",
  CHARACTER_VARIANT_FILE_KIND_MISMATCH:
    "キャラクターvariantの画像ファイル形式が正しくありません。",
  CHARACTER_VARIANT_FILE_CHECKSUM_MISMATCH:
    "キャラクターvariantの画像ファイルが更新されています。"
};

const stateLabels: Readonly<Record<ManifestPreviewState, string>> = {
  current: "最新のプレビュー",
  stale: "以前の成功プレビュー（要更新）",
  missing: "未生成",
  invalid: "読み込み不可"
};

const stateDescriptions: Readonly<Record<ManifestPreviewState, string>> = {
  current: "現在のプロジェクト入力に対応したプレビューです。",
  stale:
    "保存済みの以前の成功結果を表示できますが、現在の入力では再生できません。",
  missing: "保存済みの動画構成情報がありません。",
  invalid: "保存済みの動画構成情報を読み込めません。"
};

const blockerMessages: Readonly<Record<string, string>> = {
  OUTLINE_NOT_APPROVED: "構成案を承認してからプレビューを生成してください。",
  OUTLINE_SOURCE_HASH_MISMATCH:
    "元資料が更新されています。構成案を確認して再承認してください。",
  SCRIPT_NOT_APPROVED:
    "台本の内容を検証できません。入力と構成案との整合性を確認してください。",
  SCRIPT_OUTLINE_HASH_MISMATCH:
    "構成案が更新されています。台本を確認して再承認してください。",
  VISUALS_NOT_APPROVED:
    "素材の割り当てを検証できません。範囲・素材状態・表示設定を確認してください。",
  AUDIO_INDEX_ENTRY_MISSING: "必要な音声が未生成です。音声を生成してください。",
  AUDIO_ENTRY_STALE:
    "音声が現在の台本と一致しません。音声を再生成してください。",
  AUDIO_INDEX_UNREADABLE:
    "音声インデックスを読み込めません。音声を確認してください。",
  AUDIO_MANIFEST_STALE:
    "保存済みプレビューの音声が現在の音声と一致しません。再生成が必要です。",
  ASSET_MISSING:
    "プレビューに必要な素材が見つかりません。素材を確認してください。",
  ASSET_PATH_INVALID:
    "プレビュー素材の参照先が不正です。割り当てを確認してください。",
  ASSET_UNREADABLE: "プレビュー素材を読み込めません。素材を確認してください。",
  ASSET_CHECKSUM_MISMATCH:
    "プレビュー素材が更新されています。素材を再確認してください。",
  MANIFEST_NOT_FOUND:
    "保存済みプレビューがありません。必要な工程を完了してください。",
  MANIFEST_INVALID:
    "保存済みプレビューが不正です。プレビューを再生成してください。",
  MANIFEST_UNREADABLE:
    "保存済みプレビューを読み込めません。プレビューを再生成してください。",
  MANIFEST_PROJECT_STALE:
    "保存済みプレビューが現在のプロジェクトと一致しません。再生成してください。"
};

const blockerOrder: readonly string[] = [
  "MANIFEST_NOT_FOUND",
  "MANIFEST_INVALID",
  "MANIFEST_UNREADABLE",
  "MANIFEST_PROJECT_STALE",
  "OUTLINE_NOT_APPROVED",
  "OUTLINE_SOURCE_HASH_MISMATCH",
  "SCRIPT_NOT_APPROVED",
  "SCRIPT_OUTLINE_HASH_MISMATCH",
  "VISUALS_NOT_APPROVED",
  "AUDIO_INDEX_UNREADABLE",
  "AUDIO_INDEX_ENTRY_MISSING",
  "AUDIO_ENTRY_STALE",
  "AUDIO_MANIFEST_STALE",
  "ASSET_PATH_INVALID",
  "ASSET_MISSING",
  "ASSET_UNREADABLE",
  "ASSET_CHECKSUM_MISMATCH"
];

function compileDiagnosticTarget(
  diagnostic: ManifestCompileDiagnostic
): string {
  const targets = [
    diagnostic.lineId === undefined ? null : `セリフ ${diagnostic.lineId}`,
    diagnostic.assignmentId === undefined
      ? null
      : `割り当て ${diagnostic.assignmentId}`,
    diagnostic.sectionId === undefined ? null : `対象 ${diagnostic.sectionId}`,
    diagnostic.variantId === undefined
      ? null
      : `variant ${diagnostic.variantId}`,
    diagnostic.assetPath === undefined ? null : `素材 ${diagnostic.assetPath}`
  ].filter((target): target is string => target !== null);
  if (targets.length > 0) {
    return targets.join(" / ");
  }
  return diagnostic.path.length > 0
    ? diagnostic.path.join(".")
    : "プロジェクト全体";
}

export function createPreviewCompileDiagnosticViewModel(
  diagnostics: readonly ManifestCompileDiagnostic[]
): readonly PreviewCompileDiagnosticViewModel[] {
  return diagnostics.map((diagnostic) => ({
    diagnostic,
    title:
      compileDiagnosticTitles[diagnostic.code] ??
      "プレビュー作成に必要な項目を確認してください。",
    target: compileDiagnosticTarget(diagnostic)
  }));
}

function blockerSortIndex(code: string): number {
  const index = blockerOrder.indexOf(code);
  return index < 0 ? blockerOrder.length : index;
}

function blockerKey(blocker: ManifestPreviewBlocker): string {
  return JSON.stringify([blocker.code, blocker.target]);
}

function targetView(
  projectId: string,
  target: ManifestPreviewBlocker["target"]
): { readonly label: string; readonly href: string } {
  const projectPath = encodeURIComponent(projectId);
  switch (target.kind) {
    case "outline":
      return {
        label: "構成案を確認",
        href: `/projects/${projectPath}/outline`
      };
    case "script":
      return { label: "台本を確認", href: `/projects/${projectPath}/script` };
    case "visuals":
      return {
        label: "ビジュアル割り当てを確認",
        href: `/projects/${projectPath}/script#visual-plan`
      };
    case "voice":
      return {
        label: "音声操作を確認",
        href: `/projects/${projectPath}/script#voice-generation-title`
      };
    case "asset":
      return {
        label: "素材割り当てを確認",
        href:
          target.assignmentId === undefined
            ? `/projects/${projectPath}/script`
            : `/projects/${projectPath}/script#visual-plan`
      };
    case "manifest":
      return {
        label: "制作工程を確認",
        href: `/projects/${projectPath}/script`
      };
  }
}

function toBlockerViewModel(
  blocker: ManifestPreviewBlocker,
  projectId: string
): PreviewBlockerViewModel {
  const target = targetView(projectId, blocker.target);
  return {
    blocker,
    message:
      blockerMessages[blocker.code] ??
      `プレビューを実行できない理由を確認してください。（コード: ${blocker.code}）`,
    targetLabel: target.label,
    href: target.href
  };
}

export function createPreviewViewModel(
  data: ManifestPreviewData,
  projectId: string
): PreviewViewModel {
  const blockers = [...data.blockers]
    .filter(
      (blocker, index, all) =>
        all.findIndex(
          (candidate) => blockerKey(candidate) === blockerKey(blocker)
        ) === index
    )
    .sort((left, right) => {
      const orderDifference =
        blockerSortIndex(left.code) - blockerSortIndex(right.code);
      return orderDifference !== 0
        ? orderDifference
        : left.code.localeCompare(right.code);
    })
    .map((blocker) => toBlockerViewModel(blocker, projectId));

  return {
    stateLabel: stateLabels[data.state],
    stateDescription: stateDescriptions[data.state],
    previousSuccess: data.state === "stale" && data.manifest !== null,
    canPlay: data.canPlay && data.manifest !== null,
    blockers
  };
}

export function createPreviewPlayerProps(
  data: ManifestPreviewData,
  projectId: string
): PreviewPlayerProps | null {
  if (!data.canPlay || data.manifest === null) {
    return null;
  }

  const manifest = data.manifest;
  return {
    durationInFrames: manifest.durationInFrames,
    fps: manifest.fps,
    compositionWidth: manifest.width,
    compositionHeight: manifest.height,
    inputProps: {
      manifest,
      assetUrlResolver: createProjectManifestAssetUrlResolver(projectId)
    }
  };
}
