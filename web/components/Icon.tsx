// Small line-icon set (24px grid, 1.7 stroke), in the spirit of Material Symbols.
const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  copy: "M8 8h11v11H8zM5 16V5h11",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  play: "M7 4.5v15l12.5-7.5z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  extend: "M3 6h10v12H3zM17 12h5M19.5 9.5L22 12l-2.5 2.5",
  image: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15.5 8.5h.01",
  x: "M6 6l12 12M18 6L6 18",
  gear: "M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 01-1.7 1l-.3 2h-4l-.3-2a7 7 0 01-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 010-3L3 9.3l2-3.4 1.9.7a7 7 0 011.7-1l.3-2h4l.3 2a7 7 0 011.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 010 3z",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 100 6 3 3 0 000-6z",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  stop: "M7 7h10v10H7z",
  key: "M14 10a4 4 0 11-1.2-2.8M12.8 7.2L21 15.4V19h-3v-2h-2v-2h-2",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  home: "M4 11l8-7 8 7M6 9.5V20h4.5v-5h3v5H18V9.5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  person: "M12 4a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6",
  scenes: "M3 7h18v12H3zM3 7l3-3h3L6 7M10 7l3-3h3l-3 3M17 7l3-3",
  folder: "M3 6h6l2 2h10v11H3z",
  panel: "M4 4h16v16H4zM9 4v16M15 10l-2 2 2 2",
  search: "M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM15.5 15.5L20 20",
  filter: "M4 6h16M7 12h10M10 18h4",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01",
  tune: "M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4M4 12h13M20 12h0M19 10v4",
  send: "M5 12h14M13 6l6 6-6 6",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  collapse: "M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7",
  more: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  chevron: "M7 10l5 5 5-5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  menu: "M4 7h16M4 12h16M4 17h16",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  frame: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 9h6v6H9z",
  scene_add: "M3 7h12v10H3zM19 9v6M16 12h6",
};

export function Icon({ name, size = 18, title }: { name: string; size?: number; title?: string }) {
  const filled = name === "play";
  const d = PATHS[name] ?? PATHS.spark;
  const dotty = name === "more";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : dotty ? 3 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className="icon"
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
