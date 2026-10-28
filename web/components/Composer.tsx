"use client";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { loadSchema } from "@/lib/client-api";
import { compressImage } from "@/lib/media";
import { CUSTOM_KEY, MODELS, SPACE_KEY, findModel, providerOf } from "@/lib/models";
import { buildInput, chooseEndpoint } from "@/lib/plan";
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
}

export interface ComposerHandle {
  focus: () => void;
  /** add a dropped/pasted image: start frame first, then ingredients */
  addImage: (file: Blob) => void;
}

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "21:9"];
const MAX_REFS = 3;

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
    onOpenSettings: () => void;
    onAspect: (a: Aspect) => void;
    onNotice: (text: string) => void;
  }
>(function Composer({ project, draft, ready, extending, onChange, onGenerate, onOpenSettings, onAspect, onNotice }, ref) {
  const [count, setCount] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [tried, setTried] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef<Slot>("start");

  const choice = chooseEndpoint(draft);
  const callMode: "text" | "image" = choice.mode === "image" ? "image" : "text";
  const { schema, error: schemaError } = useSchema(choice.endpoint, callMode, choice.imageField);
  const model = findModel(draft.modelKey);
  const free = providerOf(choice.endpoint) === "hf";

  // the settings panel is kept Flow-simple, so camera presets, look and per-model
  // overrides saved by older versions are not applied: models use their defaults
  const plain = useMemo(() => ({ ...draft, camera: {}, params: quickParams(schema, draft.params) }), [draft, schema]);
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
      else onChange({ references: [...draft.references, data].slice(0, MAX_REFS) });
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    }
  }

  useImperativeHandle(ref, () => ({
    focus: () => textarea.current?.focus(),
    addImage: (file) => putImage(file, !draft.startFrame ? "start" : "ref"),
  }));

  function pick(slot: Slot) {
    pendingSlot.current = slot;
    fileInput.current?.click();
  }

  function send() {
    setTried(true);
    if (needsKey) return onOpenSettings();
    if (!canSend || !built || !choice.endpoint) {
      if (problems[0]) onNotice(problems[0]);
      return;
    }
    onGenerate({ endpoint: choice.endpoint, modelName: choice.modelName, input: built.input, prompt: built.prompt, mode: callMode }, count);
  }

  const chips: { key: string; label: string; src: string; remove: () => void; warn?: string }[] = [];
  if (draft.startFrame)
    chips.push({
      key: "start",
      label: "Start",
      src: draft.startFrame,
      remove: () => onChange({ startFrame: undefined, endFrame: undefined, afterTakeId: undefined }),
      warn: textOnly ? "This model can't start from an image" : undefined,
    });
  if (draft.endFrame)
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
      label: "Ingredient",
      src,
      remove: () => onChange({ references: draft.references.filter((_, j) => j !== i) }),
      warn: !supportsRefs ? "Only Veo 3.1 uses ingredients" : undefined,
    }),
  );

  const showProblem = tried && !needsKey && problems[0];

  return (
    <div className={"composer" + (expanded ? " composer--expanded" : "")}>
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
          placeholder="What do you want to create?"
          aria-label="Prompt"
          onChange={(e) => onChange({ prompt: e.target.value })}
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
              putImage(file, !draft.startFrame ? "start" : "ref");
            }
          }}
        />
        <button className="icon-btn composer__expand" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? "Shrink" : "Expand"}>
          <Icon name={expanded ? "collapse" : "expand"} size={16} />
        </button>
      </div>

      {showProblem ? <p className="composer__problem">{problems[0]}</p> : null}

      <div className="composer__bar">
        <Popover label="Add images" trigger={<Icon name="plus" size={18} />} buttonClass="round-btn">
          {(close) => (
            <div className="menu">
              <MenuItem
                icon={<Icon name="image" />}
                onClick={() => {
                  close();
                  pick("start");
                }}
                disabled={textOnly}
                hint={textOnly ? "This model is text-only" : "The model animates this image"}
              >
                Start frame
              </MenuItem>
              <MenuItem
                icon={<Icon name="frame" />}
                onClick={() => {
                  close();
                  pick("end");
                }}
                disabled={!draft.startFrame || !supportsEnd}
                hint={!draft.startFrame ? "Add a start frame first" : !supportsEnd ? "Not supported by this model" : "Where the shot lands"}
              >
                End frame
              </MenuItem>
              <MenuItem
                icon={<Icon name="person" />}
                onClick={() => {
                  close();
                  pick("ref");
                }}
                disabled={draft.references.length >= MAX_REFS}
                hint={supportsRefs ? "Characters, objects or a style to keep" : "Used by Veo 3.1 (ingredients)"}
              >
                Ingredient
              </MenuItem>
              {project.characters?.length ? (
                <>
                  <div className="menu__label">Characters</div>
                  {project.characters.map((ch: Character) => (
                    <MenuItem
                      key={ch.id}
                      icon={
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="menu-item__thumb" src={ch.image} alt="" />
                      }
                      onClick={() => {
                        close();
                        if (supportsRefs) onChange({ references: [...draft.references, ch.image].slice(0, MAX_REFS) });
                        else onChange({ startFrame: ch.image });
                      }}
                      hint={supportsRefs ? "Add as ingredient" : "Use as start frame"}
                    >
                      {ch.name}
                    </MenuItem>
                  ))}
                </>
              ) : null}
            </div>
          )}
        </Popover>

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
          {(close) => (
            <div className="menu menu--models">
              <div className="menu__label">Free — no key</div>
              {MODELS.filter((m) => m.free).map((m) => (
                <ModelRow key={m.key} name={m.name} maker={m.maker} price={m.price} active={draft.modelKey === m.key} onPick={() => { onChange({ modelKey: m.key, params: {}, customEndpoint: undefined }); close(); }} />
              ))}
              <ModelRow name="Any Space, or your own GPU…" maker="Hugging Face / Kaggle / Colab" active={draft.modelKey === SPACE_KEY} onPick={() => { onChange({ modelKey: SPACE_KEY, params: {}, customEndpoint: "" }); close(); }} />
              <div className="menu__label">fal.ai — your key, pay per second</div>
              {MODELS.filter((m) => !m.free).map((m) => (
                <ModelRow key={m.key} name={m.name} maker={m.maker} price={m.price} active={draft.modelKey === m.key} onPick={() => { onChange({ modelKey: m.key, params: {}, customEndpoint: undefined }); close(); }} />
              ))}
              <ModelRow name="Custom fal endpoint…" maker="Any video model on fal.ai" active={draft.modelKey === CUSTOM_KEY} onPick={() => { onChange({ modelKey: CUSTOM_KEY, params: {}, customEndpoint: "" }); close(); }} />
            </div>
          )}
        </Popover>

        <span className="composer__meta">
          {[
            project.aspect,
            durField && (plain.params[durField.name] ?? durField.default) !== undefined ? durationLabel(plain.params[durField.name] ?? durField.default) : "",
            resField && (plain.params[resField.name] ?? resField.default) !== undefined ? resolutionLabel(plain.params[resField.name] ?? resField.default).split(" ")[0] : "",
            count > 1 ? `×${count}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>

        <span className="spacer" />

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
                  {draft.modelKey === SPACE_KEY
                    ? "A running video Space, or the share link of your own Shotflow studio on Kaggle/Colab."
                    : "Any video model on fal.ai."}
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
                <Choice
                  options={durationOptions(durField)}
                  value={plain.params[durField.name] ?? durField.default}
                  label={durationLabel}
                  onPick={(v) => setParam(durField.name, v)}
                />
              </div>
            ) : null}
            {resField ? (
              <div className="tune__row">
                <span className="field__label">Resolution</span>
                <Choice
                  options={resField.options ?? []}
                  value={plain.params[resField.name] ?? resField.default}
                  label={resolutionLabel}
                  onPick={(v) => setParam(resField.name, v)}
                />
              </div>
            ) : null}
            {schema && (!durField || !resField) ? (
              <p className="dim small">
                {!durField && !resField ? "This model has a fixed length and resolution." : !durField ? "This model has a fixed length." : "This model has a fixed resolution."}
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
            for (const f of files.slice(0, MAX_REFS - draft.references.length)) added.push(await compressImage(f, 1280, 0.85));
            onChange({ references: [...draft.references, ...added].slice(0, MAX_REFS) });
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

function ModelRow({ name, maker, price, active, onPick }: { name: string; maker: string; price?: string; active: boolean; onPick: () => void }) {
  return (
    <button type="button" className={"model-row" + (active ? " is-active" : "")} onClick={onPick}>
      <span className="model-row__main">
        <span className="model-row__name">{name}</span>
        <span className="model-row__maker">{maker}</span>
      </span>
      {price ? <span className="model-row__price mono">{price}</span> : null}
      {active ? <Icon name="check" size={16} /> : null}
    </button>
  );
}
