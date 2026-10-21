"use client";
import { useRef, useState } from "react";
import { compressImage } from "@/lib/media";
import { Icon } from "./Icon";

export function FrameTile({
  label,
  hint,
  value,
  onChange,
  disabledReason,
  aspect,
}: {
  label: string;
  hint?: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  disabledReason?: string;
  aspect: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [w, h] = aspect.split(":").map(Number);

  async function take(file?: File | Blob | null) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      onChange(await compressImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = Boolean(disabledReason) && !value;

  return (
    <div className={"frame" + (disabled ? " frame--off" : "")} title={disabled ? disabledReason : undefined}>
      <div className="frame__label">
        <span>{label}</span>
        {value ? (
          <button className="link-btn" onClick={() => onChange(undefined)}>
            Remove
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="frame__drop"
        style={{ aspectRatio: `${w || 16} / ${h || 9}` }}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) take(e.dataTransfer.files?.[0]);
        }}
        onPaste={(e) => {
          const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
          if (item) take(item.getAsFile());
        }}
        aria-label={value ? `Replace ${label}` : `Add ${label}`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} />
        ) : (
          <span className="frame__empty">
            <Icon name="image" size={20} />
            <span>{busy ? "Reading…" : disabled ? disabledReason : hint ?? "Drop, paste or click"}</span>
          </span>
        )}
      </button>
      {error ? <p className="frame__error">{error}</p> : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function IngredientsTile({
  values,
  onChange,
  max = 3,
  disabledReason,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  max?: number;
  disabledReason?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const disabled = Boolean(disabledReason) && values.length === 0;

  async function add(files: FileList | File[] | null) {
    if (!files) return;
    setBusy(true);
    try {
      const next = [...values];
      for (const f of Array.from(files)) {
        if (next.length >= max) break;
        next.push(await compressImage(f, 1280, 0.85));
      }
      onChange(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"frame frame--ingredients" + (disabled ? " frame--off" : "")} title={disabled ? disabledReason : undefined}>
      <div className="frame__label">
        <span>Ingredients</span>
        <span className="frame__count">
          {values.length}/{max}
        </span>
      </div>
      <div
        className="ingredients"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) add(e.dataTransfer.files);
        }}
      >
        {values.map((src, i) => (
          <div key={i} className="ingredient">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Reference ${i + 1}`} />
            <button className="ingredient__x" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label="Remove reference">
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        {values.length < max ? (
          <button className="ingredient ingredient--add" disabled={disabled || busy} onClick={() => input.current?.click()}>
            <Icon name="plus" />
            <span>{busy ? "…" : disabled ? "n/a" : "Add"}</span>
          </button>
        ) : null}
      </div>
      <p className="frame__note">{disabled ? disabledReason : "Characters, objects or a style to keep consistent."}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
