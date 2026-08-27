import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  isWorkspaceNavigationActive,
  readSidebarCollapsed,
  WORKSPACE_NAVIGATION,
  writeSidebarCollapsed,
  type WorkspaceNavigationItem
} from "./workspace-navigation";

function WorkspaceNavIcon({
  icon
}: {
  readonly icon: WorkspaceNavigationItem["icon"];
}) {
  const path =
    icon === "projects"
      ? "M4 4h16v16H4z M8 8h3 M8 12h8 M8 16h5"
      : icon === "characters"
        ? "M12 4a3 3 0 1 1 0 6a3 3 0 0 1 0-6z M5 20a7 7 0 0 1 14 0 M4 11h2 M18 11h2"
        : icon === "assets"
          ? "M4 5h16v14H4z M4 15l4-4 3 3 3-4 6 6 M8 9h.01"
          : icon === "terminology"
            ? "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5"
            : icon === "screen-templates"
              ? "M4 5h16v14H4z M8 9h8 M8 13h5 M8 17h8"
              : icon === "insert-text-templates"
                ? "M4 5h16v14H4z M7 9h10 M7 12h7 M7 15h9"
                : "M12 7v5l3 2 M12 3a9 9 0 1 0 9 9";

  return (
    <svg
      aria-hidden="true"
      className="workspace-nav-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      {path.split(" M").map((segment, index) => (
        <path
          d={`${index === 0 ? "" : "M"}${segment}`}
          key={`${segment}-${index}`}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      ))}
    </svg>
  );
}

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function WorkspaceLayout({
  children
}: {
  readonly children: ReactNode;
}) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed(storage())
  );

  useEffect(() => {
    writeSidebarCollapsed(storage(), collapsed);
  }, [collapsed]);

  const toggleLabel = collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ";

  return (
    <div
      className={`workspace-layout${collapsed ? " workspace-layout-collapsed" : ""}`}
      data-sidebar-collapsed={collapsed}
    >
      <aside
        className="workspace-sidebar"
        aria-label="ワークスペース共通ナビゲーション"
      >
        <div className="workspace-sidebar-header">
          <Link className="workspace-brand" to="/projects" title="subdub">
            <span aria-hidden="true" className="workspace-brand-mark">
              S
            </span>
            <span className="workspace-brand-label">subdub</span>
          </Link>
          <button
            aria-controls="workspace-navigation"
            aria-expanded={!collapsed}
            aria-label={toggleLabel}
            className="workspace-sidebar-toggle"
            title={toggleLabel}
            type="button"
            onClick={() => setCollapsed((current) => !current)}
          >
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
          </button>
        </div>

        <nav
          aria-label="ワークスペース共通ナビゲーション"
          className="workspace-nav"
          id="workspace-navigation"
        >
          {Array.from(
            new Set(WORKSPACE_NAVIGATION.map((item) => item.section))
          ).map((section) => (
            <div className="workspace-nav-section" key={section}>
              <p className="workspace-nav-section-label">{section}</p>
              <ul>
                {WORKSPACE_NAVIGATION.filter(
                  (item) => item.section === section
                ).map((item) => {
                  const active = isWorkspaceNavigationActive(
                    location.pathname,
                    item
                  );
                  return (
                    <li key={item.id}>
                      <Link
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        className={`workspace-nav-link${active ? " workspace-nav-link-active" : ""}`}
                        data-nav-id={item.id}
                        title={item.label}
                        to={item.path}
                      >
                        <WorkspaceNavIcon icon={item.icon} />
                        <span className="workspace-nav-label">
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="workspace-main">{children}</div>
    </div>
  );
}
