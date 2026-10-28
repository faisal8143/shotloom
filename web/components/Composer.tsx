"use client";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { api, loadSchema } from "@/lib/client-api";
import { compressImage } from "@/lib/media";
import { CUSTOM_KEY, SPACE_KEY, findModel, modelsOfKind, providerOf, type ModelDef } from "@/lib/models";
import { buildInput, chooseEndpoint } from "@/lib/plan";
import { estimate, formatUsd } from "@/lib/pricing";
import { durationField, durationLabel, durationOptions, quickParams, resolutionField, resolutionLabel } from "@/lib/quick-settings";
import { endImageField, fallbackSchema, referenceImagesField, type ModelSchema } from "@/lib/schema";
import type { Aspect, Character, Project, Shot } from "@/lib/types";
import { Icon } from "./Icon";
import { MenuItem, Popover } from "./Popover";

export interface GeneratePlan {
  endpoint: string;
  modelName: string;
  input: Record<string, unknown>;
  prompt: string;
  /** which kind of endpoint was picked, so the runner reads the same schema */
  mode: "text" | "image";
  /** what the generation makes */
  kind: "video" | "image";
}

export interface ComposerHandle {
  focus: () => void;
  /** add a dropped/pasted image: start frame first, then ingredients */
  addImage: (file: Blob) => void;
}

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "21:9"];
const MAX_REFS = { video: 3, image: 6 };
const DEFAULT_MODEL = { video: "ltx-free", image: "nano-banana-21" };

function useSchema(endpoint: string | undefined, mode: "text" | "image", imageField?: string) {
  const [state, setState] = useState<{ key?: string; schema?: ModelSchema; error?: string }>({});
  const key = endpoint ? `${endpoint}|${mode}` : undefined;
  useEffect(() => {
    if (!endpoint || !key) return;
    let alive = true;
    loadSchema(endpoint, mode)
      .then((schema) => alive && setState({ key, schema }))
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        // a 404 means the endpoint really doesn't exist; anything else, fall back to a minimal form
        if (e.status === 404) setState({ key, error: e.message });
        else setState({ key, schema: fallbackSchema(endpoint, imageField), error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [endpoint, mode, imageField, key]);
  return state.key === key ? state : {};
}

type Slot = "start" | "end" | "ref";

export const Composer = forwardRef<
  ComposerHandle,
  {
    project: Project;
    draft: Shot;
    ready: boolean;
    extending?: string;
    onChange: (patch: Partial<Shot>) => void;
    onGenerate: (plan: GeneratePlan, count: number) => void;
    onOpenSettings: (why?: string) => void;
    onAspect: (a: Aspect) => void;
    onNotice: (text: string) => void;
  }
>(function Composer({ project, draft, ready, extending, onChange, onGenerate, onOpenSettings, onAspect, onNotice }, ref) {
  const [count, setCount] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [tried, setTried] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [undoPrompt, setUndoPrompt] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<Slot>("start");

  const model = findModel(draft.modelKey);
  const kind: "video" | "image" = draft.kind ?? model?.kind ?? "video";
  const maxRefs = MAX_REFS[kind];

  // Image mode has no start/end frame: every attached picture is a reference to edit from.
  const working = useMemo<Shot>(
    () =>
      kind === "image"
        ? { ...draft, startFrame: undefined, endFrame: undefined, references: [...(draft.startFrame ? [draft.startFrame] : []), ...draft.references].slice(0, maxRefs) }
        : draft,
    [draft, kind, maxRefs],
  );

  const choice = chooseEndpoint(working);
  const callMode: "text" | "image" = choice.mode === "image" ? "image" : "text";
  const { schema, error: schemaError } = useSchema(choice.endpoint, callMode, choice.imageField);
  const free = providerOf(choice.endpoint) === "hf";

  // the settings panel is kept Flow-simple: only duration and resolution overrides reach the model
  const plain = useMemo(() => ({ ...working, camera: {}, params: quickParams(schema, working.params) }), [working, schema]);
  const durField = durationField(schema);
  const resField = resolutionField(schema);
  const setParam = (name: string, v: unknown) => onChange({ params: { ...draft.params, [name]: v } });
  const built = useMemo(() => (schema ? buildInput(schema, { ...project, look: "" }, plain) : undefined), [schema, project, plain]);

  const supportsEnd = schema ? Boolean(endImageField(schema)) : false;
  const supportsRefs = model ? Boolean(model.endpoints.reference) : schema ? Boolean(referenceImagesField(schema)) : false;
  const textOnly = model ? !model.endpoints.image && !model.endpoints.reference : false;
  const problems = [choice.error, !choice.error && !schema && schemaError, ...(built?.errors ?? [])].filter(Boolean) as string[];
  const loading = Boolean(choice.endpoint) && !schema && !schemaError;
  const needsKey = !ready && !free;
  const canSend = !needsKey && !!schema && !!choice.endpoint && problems.length === 0;

  // what this press of "send" will roughly cost
  const effective = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of schema?.fields ?? []) if (f.default !== undefined) out[f.name] = f.default;
    return { ...out, ...(built?.input ?? {}) };
  }, [schema, built]);
  const cost = free ? 0 : estimate(draft.modelKey, kind, effective, count);

  // auto-grow the prompt box
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, expanded ? 420 : 168) + "px";
  }, [draft.prompt, expanded]);

  useEffect(() => setTried(false), [draft.prompt, draft.modelKey, draft.startFrame]);

  async function putImage(file: Blob, slot: Slot) {
    try {
      const data = await compressImage(file, slot === "ref" ? 1280 : 1600, slot === "ref" ? 0.85 : 0.88);
      if (slot === "start") onChange({ startFrame: data });
      else if (slot === "end") onChange({ endFrame: data });
      else onChange({ references: [...draft.references, data].slice(0, maxRefs) });
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    addImage: (file) => putImage(file, kind === "image" || draft.startFrame ? "ref" : "start"),
  }));

  function pick(slot: Slot) {
    pendingSlot.current = slot;
    fileInput.current?.click();
  }

  function switchKind(next: "video" | "image") {
    if (next === kind) return;
    const keep = findModel(draft.modelKey);
    onChange({
      kind: next,
      modelKey: keep && (keep.kind ?? "video") === next ? keep.key : DEFAULT_MODEL[next],
      customEndpoint: undefined,
      params: {},
      afterTakeId: undefined,
    });
  }

  async function enhance() {
    if (!draft.prompt.trim()) return onNotice("Write a short idea first, in any language. Enhance turns it into a detailed prompt.");
    if (!ready) return onOpenSettings("Enhance uses your fal.ai key (a fraction of a cent per use).");
    setEnhancing(true);
    try {
      const res = await api.enhance(draft.prompt, kind, Boolean(working.startFrame));
      setUndoPrompt(draft.prompt);
      onChange({ prompt: res.prompt });
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setEnhancing(false);
    }
  }

  function send() {
    setTried(true);
    if (needsKey) return onOpenSettings("This model runs on fal.ai and needs your key. The LTX models are free.");
    if (!canSend || !built || !choice.endpoint) {
      if (problems[0]) onNotice(problems[0]);
      return;
    }
    setUndoPrompt(undefined);
    onGenerate({ endpoint: choice.endpoint, modelName: choice.modelName, input: built.input, prompt: built.prompt, mode: callMode, kind }, count);
  }

  const chips: { key: string; label: string; src: string; remove: () => void; warn?: string }[] = [];
  if (draft.startFrame)
    chips.push({
      key: "start",
      label: kind === "image" ? "Reference" : "Start",
      src: draft.startFrame,
      remove: () => onChange({ startFrame: undefined, endFrame: undefined, afterTakeId: undefined }),
      warn: kind === "video" && textOnly ? "This model can't start from an image" : kind === "image" && !supportsRefs ? "This model is text-only" : undefined,
    });
  if (draft.endFrame && kind === "video")
    chips.push({
      key: "end",
      label: "End",
      src: draft.endFrame,
      remove: () => onChange({ endFrame: undefined }),
      warn: !supportsEnd ? "Ignored by this model" : undefined,
    });
  draft.references.forEach((src, i) =>
    chips.push({
      key: "ref" + i,
      label: kind === "image" ? "Reference" : "Ingredient",
      src,
      remove: () => onChange({ references: draft.references.filter((_, j) => j !== i) }),
      warn: !supportsRefs ? (kind === "image" ? "This model is text-only" : "Only Veo 3.1 uses ingredients") : undefined,
    }),
  );

  const showProblem = tried && !needsKey && problems[0];
  const durValue = durField ? (plain.params[durField.name] ?? durField.default) : undefined;
  const resValue = resField ? (plain.params[resField.name] ?? resField.default) : undefined;

  return (
    <div className={"composer" + (expanded ? " composer--expanded" : "") + (enhancing ? " is-enhancing" : "")}>
      {extending || chips.length ? (
        <div className="composer__chips">
          {extending ? (
            <span className="att att--note">
              <Icon name="extend" size={16} /> Extending “{extending}”
              <button className="att__x" onClick={() => onChange({ afterTakeId: undefined })} aria-label="Stop extending">
                <Icon name="x" size={12} />
              </button>
            </span>
          ) : null}
          {chips.map((c) => (
            <span key={c.key} className={"att" + (c.warn ? " att--warn" : "")} title={c.warn ?? c.label}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.src} alt="" />
              <span className="att__label">{c.label}</span>
              <button className="att__x" onClick={c.remove} aria-label={`Remove ${c.label}`}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="composer__input">
        <textarea
          ref={textarea}
          rows={1}
          value={draft.prompt}
          placeholder={kind === "image" ? "Describe an image to create…" : "What do you want to create?"}
          aria-label="Prompt"
          disabled={enhancing}
          onChange={(e) => {
            setUndoPrompt(undefined);
            onChange({ prompt: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
            const file = item?.getAsFile();
            if (file) {
              e.preventDefault();
              putImage(file, kind === "image" || draft.startFrame ? "ref" : "start");
            }
          }}
        />
        <button className="icon-btn composer__expand" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? "Shrink" : "Expand"}>
          <Icon name={expanded ? "collapse" : "expand"} size={16} />
        </button>
      </div>

      {showProblem ? <p className="composer__problem">{problems[0]}</p> : null}
      {undoPrompt !== undefined ? (
        <p className="composer__enhanced">
          <Icon name="spark" size={14} /> Prompt enhanced.
          <button className="link-btn" onClick={() => { onChange({ prompt: undoPrompt }); setUndoPrompt(undefined); }}>
            Undo
          </button>
        </p>
      ) : null}

      <div className="composer__bar">
        <Popover label="Add images" trigger={<Icon name="plus" size={18} />} buttonClass="round-btn">
          {(close) => (
            <div className="menu">
              {kind === "video" ? (
                <>
                  <MenuItem icon={<Icon name="image" />} onClick={() => { close(); pick("start"); }} disabled={textOnly} hint={textOnly ? "This model is text-only" : "The model animates this image"}>
                    Start frame
                  </MenuItem>
                  <MenuItem
                    icon={<Icon name="frame" />}
                    onClick={() => { close(); pick("end"); }}
                    disabled={!draft.startFrame || !supportsEnd}
                    hint={!draft.startFrame ? "Add a start frame first" : !supportsEnd ? "Not supported by this model" : "Where the shot lands"}
                  >
                    End frame
                  </MenuItem>
                </>
              ) : null}
              <MenuItem
                icon={<Icon name="person" />}
                onClick={() => { close(); pick("ref"); }}
                disabled={draft.references.length >= maxRefs}
                hint={kind === "image" ? (supportsRefs ? "Edit or combine pictures" : "Pick Nano Banana to edit images") : supportsRefs ? "Characters, objects or a style to keep" : "Used by Veo 3.1 (ingredients)"}
              >
                {kind === "image" ? "Reference image" : "Ingredient"}
              </MenuItem>
              {project.characters?.length ? (
                <>
                  <div className="menu__label">Characters</div>
                  {project.characters.map((ch: Character) => (
                    <MenuItem
                      key={ch.id}
                      // eslint-disable-next-line @next/next/no-img-element
                      icon={<img className="menu-item__thumb" src={ch.image} alt="" />}
                      onClick={() => {
                        close();
                        if (kind === "image" || supportsRefs) onChange({ references: [...draft.references, ch.image].slice(0, maxRefs) });
                        else onChange({ startFrame: ch.image });
                      }}
                      hint={kind === "image" || supportsRefs ? "Add as reference" : "Use as start frame"}
                    >
                      {ch.name}
                    </MenuItem>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </Popover>

        <div className="kind-switch" role="tablist" aria-label="What to create">
          <button role="tab" aria-selected={kind === "video"} className={kind === "video" ? "is-on" : ""} onClick={() => switchKind("video")} title="Video">
            <Icon name="film" size={15} />
            <span>Video</span>
          </button>
          <button role="tab" aria-selected={kind === "image"} className={kind === "image" ? "is-on" : ""} onClick={() => switchKind("image")} title="Image">
            <Icon name="image" size={15} />
            <span>Image</span>
          </button>
        </div>

        <Popover
          label="Model"
          className="models-panel"
          trigger={
            <>
              <span className={"model-dot" + (free ? " model-dot--free" : "")} aria-hidden />
              <span className="chip-btn__text">{choice.modelName}</span>
              <Icon name="chevron" size={14} />
            </>
          }
        >
          {(close) => {
            const choose = (patch: Partial<Shot>) => {
              onChange({ params: {}, customEndpoint: undefined, ...patch });
              close();
            };
            const list = modelsOfKind(kind);
            return (
              <div className="menu menu--models">
                {kind === "video" ? (
                  <>
                    <div className="menu__label">Free — no key</div>
                    {list.filter((m) => m.free).map((m) => (
                      <ModelRow key={m.key} model={m} active={draft.modelKey === m.key} onPick={() => choose({ modelKey: m.key })} />
                    ))}
                    <ModelRow
                      model={{ key: SPACE_KEY, name: "Any Space, or your own GPU…", maker: "Hugging Face / Kaggle / Colab", blurb: "", endpoints: {} }}
                      active={draft.modelKey === SPACE_KEY}
                      onPick={() => choose({ modelKey: SPACE_KEY, customEndpoint: "" })}
                    />
                    <div className="menu__label">fal.ai — your key, pay per second</div>
                  </>
                ) : (
                  <div className="menu__label">fal.ai — your key, pay per image</div>
                )}
                {list.filter((m) => !m.free).map((m) => (
                  <ModelRow key={m.key} model={m} active={draft.modelKey === m.key} onPick={() => choose({ modelKey: m.key })} />
                ))}
                {kind === "video" ? (
                  <ModelRow
                    model={{ key: CUSTOM_KEY, name: "Custom fal endpoint…", maker: "Any video model on fal.ai", blurb: "", endpoints: {} }}
                    active={draft.modelKey === CUSTOM_KEY}
                    onPick={() => choose({ modelKey: CUSTOM_KEY, customEndpoint: "" })}
                  />
                ) : null}
              </div>
            );
          }}
        </Popover>

        <span className="composer__meta">
          {[
            project.aspect,
            durValue !== undefined ? durationLabel(durValue) : "",
            resValue !== undefined ? resolutionLabel(resValue).split(" ")[0] : "",
            count > 1 ? `×${count}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>

        <span className="spacer" />

        <button className={"icon-btn enhance-btn" + (enhancing ? " is-busy" : "")} onClick={enhance} disabled={enhancing} aria-label="Enhance prompt" title="Enhance prompt — turns a short idea (any language) into a detailed English prompt">
          {enhancing ? <span className="spinner spinner--sm" aria-hidden /> : <Icon name="spark" />}
        </button>

        <Popover label="Settings" align="end" className="tune-panel" buttonClass="icon-btn" trigger={<Icon name="tune" />}>
          <div className="tune">
            {draft.modelKey === SPACE_KEY || draft.modelKey === CUSTOM_KEY ? (
              <label className="field">
                <span className="field__label">{draft.modelKey === SPACE_KEY ? "Space or studio URL" : "fal endpoint ID"}</span>
                <input
                  className="mono"
                  value={draft.customEndpoint ?? ""}
                  onChange={(e) => onChange({ customEndpoint: e.target.value, params: {} })}
                  placeholder={draft.modelKey === SPACE_KEY ? "Lightricks/ltx-video-distilled or https://xxxx.gradio.live" : "fal-ai/kling-video/o3/pro/text-to-video"}
                  spellCheck={false}
                />
                <span className="field__hint">
                  {draft.modelKey === SPACE_KEY ? "A running video Space, or the share link of your own Shotflow studio on Kaggle/Colab." : "Any video model on fal.ai."}
                </span>
              </label>
            ) : model ? (
              <p className="tune__blurb">
                <strong>{model.name}</strong> {model.blurb}
                {model.price ? <span className="mono"> {model.price}</span> : null}
              </p>
            ) : null}

            <div className="tune__row">
              <span className="field__label">Aspect ratio</span>
              <div className="seg">
                {ASPECTS.map((a) => (
                  <button key={a} className={"seg__btn" + (project.aspect === a ? " is-on" : "")} onClick={() => onAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            {durField ? (
              <div className="tune__row">
                <span className="field__label">Duration</span>
                <Choice options={durationOptions(durField)} value={durValue} label={durationLabel} onPick={(v) => setParam(durField.name, v)} />
              </div>
            ) : null}
            {resField ? (
              <div className="tune__row">
                <span className="field__label">Resolution</span>
                <Choice options={resField.options ?? []} value={resValue} label={resolutionLabel} onPick={(v) => setParam(resField.name, v)} />
              </div>
            ) : null}
            {schema && (!durField || !resField) ? (
              <p className="dim small">
                {kind === "image"
                  ? !resField
                    ? "This model makes one standard size."
                    : ""
                  : !durField && !resField
                    ? "This model has a fixed length and resolution."
                    : !durField
                      ? "This model has a fixed length."
                      : "This model has a fixed resolution. Upscale any clip to FHD or 4K from its viewer."}
              </p>
            ) : null}

            <div className="tune__row">
              <span className="field__label">Outputs per prompt</span>
              <div className="seg">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} className={"seg__btn" + (count === n ? " is-on" : "")} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {built?.notes.length ? (
              <ul className="notes">
                {built.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Popover>

        {cost !== undefined && draft.prompt.trim() && !needsKey ? (
          <span className={"cost" + (cost === 0 ? " cost--free" : "")} title="Rough estimate from fal's published prices">
            {formatUsd(cost)}
          </span>
        ) : null}

        <button
          className={"send-btn" + (canSend && draft.prompt.trim() ? " is-ready" : "")}
          onClick={send}
          aria-label={needsKey ? "Add a fal key to generate" : "Generate"}
          title={needsKey ? "This model needs your fal.ai key - opens Settings" : problems[0] ?? (loading ? "Loading model…" : "Generate (Enter)")}
        >
          <Icon name={needsKey ? "key" : "send"} size={18} />
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          const slot = pendingSlot.current;
          if (slot !== "ref") {
            if (files[0]) await putImage(files[0], slot);
            return;
          }
          try {
            const added: string[] = [];
            for (const f of files.slice(0, maxRefs - draft.references.length)) added.push(await compressImage(f, 1280, 0.85));
            onChange({ references: [...draft.references, ...added].slice(0, maxRefs) });
          } catch (err) {
            onNotice(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </div>
  );
});

/** Segmented buttons for a few choices, a dropdown for many. */
function Choice({
  options,
  value,
  label,
  onPick,
}: {
  options: (string | number)[];
  value: unknown;
  label: (v: unknown) => string;
  onPick: (v: string | number) => void;
}) {
  const current = value === undefined ? undefined : String(value);
  if (options.length <= 5) {
    return (
      <div className="seg">
        {options.map((o) => (
          <button key={String(o)} className={"seg__btn" + (current === String(o) ? " is-on" : "")} onClick={() => onPick(o)}>
            {label(o)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select
      value={current ?? ""}
      onChange={(e) => {
        const o = options.find((x) => String(x) === e.target.value);
        if (o !== undefined) onPick(o);
      }}
    >
      {current === undefined ? <option value="">Model default</option> : null}
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}

function ModelRow({ model, active, onPick }: { model: ModelDef; active: boolean; onPick: () => void }) {
  return (
    <button type="button" className={"model-row" + (active ? " is-active" : "")} onClick={onPick}>
      <span className="model-row__main">
        <span className="model-row__name">
          {model.name}
          {model.badge ? <span className={"badge" + (model.free ? " badge--free" : "")}>{model.badge}</span> : null}
        </span>
        <span className="model-row__maker">
          {model.maker}
          {model.price && !model.free ? <span className="model-row__price"> · {model.price.replace(/^≈\s*/, "")}</span> : null}
        </span>
      </span>
      {active ? <Icon name="check" size={16} /> : null}
    </button>
  );
}
