const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  copy: "M8 8h11v11H8zM5 16V5h11",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  play: "M7 4.5v15l12.5-7.5z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z",
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
  chevron: "M9 6l6 6-6 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
};

export function Icon({ name, size = 16, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  const filled = name === "play" || name === "star-filled";
  const d = PATHS[name === "star-filled" ? "star" : name] ?? PATHS.spark;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
