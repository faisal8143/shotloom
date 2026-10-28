"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a floating panel; closes on outside click or Escape. */
export function Popover({
  trigger,
  children,
  className = "",
  placement = "up",
  align = "start",
  label,
  buttonClass = "chip-btn",
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  className?: string;
  placement?: "up" | "down";
  align?: "start" | "end";
  label: string;
  buttonClass?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (v: boolean) => {
    setInnerOpen(v);
    onOpenChange?.(v);
  };
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div className="pop" ref={root}>
      <button
        type="button"
        className={buttonClass + (open ? " is-open" : "")}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div className={`pop__panel pop__panel--${placement} pop__panel--${align} ${className}`} role="dialog" aria-label={label}>
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  hint,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={"menu-item" + (danger ? " menu-item--danger" : "")} onClick={onClick} disabled={disabled}>
      {icon ? <span className="menu-item__icon">{icon}</span> : null}
      <span className="menu-item__text">
        {children}
        {hint ? <span className="menu-item__hint">{hint}</span> : null}
      </span>
    </button>
  );
}
