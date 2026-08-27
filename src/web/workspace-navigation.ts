export const WORKSPACE_SIDEBAR_STORAGE_KEY =
  "subdub.workspace-sidebar.collapsed";

export const WORKSPACE_NAVIGATION = [
  {
    id: "projects",
    label: "プロジェクト",
    section: "制作",
    path: "/projects",
    icon: "projects"
  },
  {
    id: "character-visuals",
    label: "キャラクタービジュアル",
    section: "ライブラリ",
    path: "/character-visuals",
    icon: "characters"
  },
  {
    id: "screen-templates",
    label: "画面テンプレート",
    section: "ライブラリ",
    path: "/screen-templates",
    icon: "screen-templates"
  },
  {
    id: "insert-text-templates",
    label: "挿入文字テンプレート",
    section: "ライブラリ",
    path: "/insert-text-templates",
    icon: "insert-text-templates"
  },
  {
    id: "assets",
    label: "素材",
    section: "ライブラリ",
    path: "/assets",
    icon: "assets"
  },
  {
    id: "terminology",
    label: "用語",
    section: "ライブラリ",
    path: "/terminology",
    icon: "terminology"
  },
  {
    id: "ai-runs",
    label: "AI実行履歴",
    section: "運用",
    path: "/ai-runs",
    icon: "history"
  }
] as const;

export type WorkspaceNavigationItem = (typeof WORKSPACE_NAVIGATION)[number];

export function isWorkspaceNavigationActive(
  pathname: string,
  item: WorkspaceNavigationItem
): boolean {
  return item.path === "/projects"
    ? pathname === "/projects" || pathname.startsWith("/projects/")
    : pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function readSidebarCollapsed(
  storage: Storage | null | undefined
): boolean {
  if (storage === null || storage === undefined) {
    return false;
  }

  try {
    return storage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(
  storage: Storage | null | undefined,
  collapsed: boolean
): void {
  if (storage === null || storage === undefined) {
    return;
  }

  try {
    storage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // A blocked or full local storage must not make navigation unusable.
  }
}
