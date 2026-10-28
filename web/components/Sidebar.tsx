"use client";
import { Icon } from "./Icon";
import { MenuItem, Popover } from "./Popover";

export type View = "media" | "characters" | "scenes" | "library" | "bin";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "media", label: "All media", icon: "grid" },
  { id: "characters", label: "Characters", icon: "person" },
  { id: "scenes", label: "Scenes", icon: "scenes" },
];

export function Sidebar({
  view,
  projectName,
  counts,
  collapsed,
  open,
  onView,
  onNewProject,
  onRename,
  onDeleteProject,
  onCollapse,
  onClose,
}: {
  view: View;
  projectName: string;
  counts: Partial<Record<View, number>>;
  collapsed: boolean;
  open: boolean;
  onView: (v: View) => void;
  onNewProject: () => void;
  onRename: () => void;
  onDeleteProject: () => void;
  onCollapse: () => void;
  onClose: () => void;
}) {
  const item = (id: View, label: string, icon: string, extra?: React.ReactNode) => (
    <div className={"nav-item" + (view === id ? " is-active" : "")} key={id}>
      <button
        className="nav-item__main"
        onClick={() => {
          onView(id);
          onClose();
        }}
        title={collapsed ? label : undefined}
        aria-current={view === id ? "page" : undefined}
      >
        <Icon name={icon} />
        <span className="nav-item__label">{label}</span>
        {counts[id] ? <span className="nav-item__count">{counts[id]}</span> : null}
      </button>
      {extra}
    </div>
  );

  return (
    <>
      <div className={"side-scrim" + (open ? " is-open" : "")} onClick={onClose} aria-hidden />
      <aside className={"side" + (collapsed ? " side--collapsed" : "") + (open ? " is-open" : "")} aria-label="Navigation">
        <div className="side__brand">
          <span className="logo" aria-hidden>
            <Icon name="spark" size={16} />
          </span>
          <span className="side__brand-name">Shotflow</span>
        </div>

        <div className="side__project">
          <button
            className="icon-btn"
            onClick={() => {
              onView("library");
              onClose();
            }}
            aria-label="All projects"
            title="All projects"
          >
            <Icon name="home" />
          </button>
          <span className="side__project-name" title={projectName}>
            {projectName}
          </span>
          <Popover label="Project options" align="start" placement="down" buttonClass="icon-btn" trigger={<Icon name="more" />}>
            {(close) => (
              <div className="menu">
                <MenuItem icon={<Icon name="edit" />} onClick={() => { close(); onRename(); }}>
                  Rename project
                </MenuItem>
                <MenuItem icon={<Icon name="plus" />} onClick={() => { close(); onNewProject(); }}>
                  New project
                </MenuItem>
                <MenuItem icon={<Icon name="trash" />} danger onClick={() => { close(); onDeleteProject(); }}>
                  Delete project
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>

        <nav className="side__nav">
          {NAV.map((n) => item(n.id, n.label, n.icon))}
          <div className="side__divider" />
          {item(
            "library",
            "Library",
            "folder",
            <button className="icon-btn nav-item__extra" onClick={onNewProject} aria-label="New project" title="New project">
              <Icon name="plus" size={16} />
            </button>,
          )}
        </nav>

        <div className="side__bottom">
          {item("bin", "Bin", "trash")}
          <div className="nav-item nav-item--collapse">
            <button className="nav-item__main" onClick={onCollapse} title={collapsed ? "Expand" : undefined}>
              <Icon name="panel" />
              <span className="nav-item__label">Collapse</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
