"use client";
import type { Field } from "@/lib/schema";

const MEDIA = new Set(["prompt", "image", "images", "video", "unknown"]);

export function editableFields(fields: Field[]): Field[] {
  return fields.filter((f) => !MEDIA.has(f.kind));
}

function Control({
  field,
  value,
  autoValue,
  onChange,
}: {
  field: Field;
  value: unknown;
  autoValue?: unknown;
  onChange: (v: unknown) => void;
}) {
  const shown = value ?? autoValue ?? field.default;
  const id = "p-" + field.name;
  const isSet = value !== undefined;

  let control;
  switch (field.kind) {
    case "enum":
      control = (
        <select id={id} value={shown === undefined ? "" : String(shown)} onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(undefined);
          const opt = field.options?.find((o) => String(o) === raw);
          onChange(opt ?? raw);
        }}>
          {shown === undefined ? <option value="">Model default</option> : null}
          {field.options?.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
      break;
    case "boolean":
      control = (
        <label className="switch">
          <input id={id} type="checkbox" checked={Boolean(shown)} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch__track" aria-hidden />
          <span>{shown ? "On" : "Off"}</span>
        </label>
      );
      break;
    case "integer":
    case "number":
      control = (
        <input
          id={id}
          type="number"
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          step={field.kind === "integer" ? 1 : "any"}
          min={field.min}
          max={field.max}
          value={shown === undefined || shown === null ? "" : String(shown)}
          placeholder={field.name === "seed" ? "random" : "default"}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            const n = field.kind === "integer" ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
      break;
    case "longtext":
      control = (
        <textarea id={id} rows={2} value={(shown as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
      );
      break;
    default:
      control = <input id={id} type="text" value={(shown as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />;
  }

  return (
    <div className={"param" + (field.kind === "longtext" ? " param--wide" : "")}>
      <label htmlFor={id} className="param__label" title={field.description}>
        {field.label}
        {field.required ? <span className="req">*</span> : null}
        {isSet ? (
          <button type="button" className="link-btn param__reset" onClick={() => onChange(undefined)} title="Back to default">
            reset
          </button>
        ) : null}
      </label>
      {control}
    </div>
  );
}

export function ParamControls({
  fields,
  values,
  autoValues,
  onChange,
}: {
  fields: Field[];
  values: Record<string, unknown>;
  autoValues: Record<string, unknown>;
  onChange: (name: string, v: unknown) => void;
}) {
  const editable = editableFields(fields);
  const core = editable.filter((f) => f.core);
  const rest = editable.filter((f) => !f.core);
  return (
    <div className="params">
      {core.length ? (
        <div className="params__grid">
          {core.map((f) => (
            <Control key={f.name} field={f} value={values[f.name]} autoValue={autoValues[f.name]} onChange={(v) => onChange(f.name, v)} />
          ))}
        </div>
      ) : null}
      {rest.length ? (
        <details className="params__more">
          <summary>More settings ({rest.length})</summary>
          <div className="params__grid">
            {rest.map((f) => (
              <Control key={f.name} field={f} value={values[f.name]} autoValue={autoValues[f.name]} onChange={(v) => onChange(f.name, v)} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
