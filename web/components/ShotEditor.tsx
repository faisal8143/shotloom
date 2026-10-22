"use client";
import { useEffect, useMemo, useState } from "react";
import { loadSchema } from "@/lib/client-api";
import { CUSTOM_KEY, MODELS, SPACE_KEY, findModel, providerOf } from "@/lib/models";
import { autoValues, buildInput, chooseEndpoint } from "@/lib/plan";
import { CAMERA, type CameraKey } from "@/lib/presets";
import { endImageField, fallbackSchema, referenceImagesField, type ModelSchema } from "@/lib/schema";
import type { Project, Shot } from "@/lib/types";
import { FrameTile, IngredientsTile } from "./FrameTile";
import { Icon } from "./Icon";
import { ParamControls } from "./ParamControls";

export interface GeneratePlan {
  endpoint: string;
  modelName: string;
  input: Record<string, unknown>;
  prompt: string;
  /** which kind of endpoint was picked, so the runner reads the same schema */
  mode: "text" | "image";
}

function useSchema(endpoint: string | undefined, mode: "text" | "image", imageField?: string) {
  const [state, setState] = useState<{ endpoint?: string; schema?: ModelSchema; error?: string }>({});
  useEffect(() => {
    if (!endpoint) return;
    let alive = true;
    setState((s) => (s.endpoint === endpoint ? s : { endpoint }));
    loadSchema(endpoint, mode)
      .then((schema) => alive && setState({ endpoint, schema }))
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        // a 404 means the endpoint really doesn't exist; anything else, fall back to a minimal form
        if (e.status === 404) setState({ endpoint, error: e.message });
        else setState({ endpoint, schema: fallbackSchema(endpoint, imageField), error: e.message });
      });
    return () => {
      alive = false;
    };
  }, [endpoint, mode, imageField]);
  return state.endpoint === endpoint ? state : {};
}

export function ShotEditor({
  project,
  shot,
  shotNumber,
  ready,
  onChange,
  onGenerate,
  onOpenSettings,
}: {
  project: Project;
  shot: Shot;
  shotNumber: number;
  ready: boolean;
  onChange: (patch: Partial<Shot>) => void;
  onGenerate: (plan: GeneratePlan, count: number) => void;
  onOpenSettings: () => void;
}) {
  const [count, setCount] = useState(1);
  const choice = chooseEndpoint(shot);
  const callMode: "text" | "image" = choice.mode === "image" ? "image" : "text";
  const { schema, error: schemaError } = useSchema(choice.endpoint, callMode, choice.imageField);
  const model = findModel(shot.modelKey);
  const free = providerOf(choice.endpoint) === "hf";

  const built = useMemo(() => (schema ? buildInput(schema, project, shot) : undefined), [schema, project, shot]);
  const auto = useMemo(() => autoValues(schema, project, shot), [schema, project, shot]);

  const supportsEnd = schema ? Boolean(endImageField(schema)) : false;
  const supportsRefs = model ? Boolean(model.endpoints.reference) : schema ? Boolean(referenceImagesField(schema)) : false;
  const textOnly = model ? !model.endpoints.image && !model.endpoints.reference : false;

  const problems = [choice.error, !choice.error && !schema && schemaError, ...(built?.errors ?? [])].filter(Boolean) as string[];
  const canGenerate = (ready || free) && !!schema && !!choice.endpoint && problems.length === 0;

  const plan = (): GeneratePlan | undefined =>
    built && choice.endpoint
      ? { endpoint: choice.endpoint, modelName: choice.modelName, input: built.input, prompt: built.prompt, mode: callMode }
      : undefined;

  function setCamera(key: CameraKey, value: string | undefined) {
    onChange({ camera: { ...shot.camera, [key]: value } });
  }

  return (
    <section className="editor" aria-label={`Shot ${shotNumber}`}>
      <div className="editor__compose">
        <div className="editor__head">
          <span className="slate mono">SHOT {String(shotNumber).padStart(2, "0")}</span>
          <input
            className="editor__title"
            value={shot.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Untitled shot"
            aria-label="Shot title"
          />
        </div>

        <textarea
          className="prompt"
          value={shot.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="Describe the shot: who or what, the action, the setting. Add dialogue in quotes if the model makes sound."
          rows={5}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGenerate) {
              const p = plan();
              if (p) onGenerate(p, count);
            }
          }}
        />

        <div className="frames">
          <FrameTile
            label="Start frame"
            hint="Optional: animate an image"
            value={shot.startFrame}
            onChange={(v) => onChange({ startFrame: v })}
            disabledReason={textOnly ? "Text-only model" : undefined}
            aspect={project.aspect}
          />
          <FrameTile
            label="End frame"
            hint="Optional: where it lands"
            value={shot.endFrame}
            onChange={(v) => onChange({ endFrame: v })}
            disabledReason={!supportsEnd ? (shot.startFrame ? "Not supported by this model" : "Needs a start frame") : undefined}
            aspect={project.aspect}
          />
          <IngredientsTile
            values={shot.references}
            onChange={(v) => onChange({ references: v })}
            disabledReason={!supportsRefs ? "Pick Veo 3.1 to use ingredients" : undefined}
          />
        </div>

        <div className="camera">
          {(Object.keys(CAMERA) as CameraKey[]).map((key) => (
            <label key={key} className="camera__pick">
              <span>{CAMERA[key].label}</span>
              <select value={shot.camera[key] ?? ""} onChange={(e) => setCamera(key, e.target.value || undefined)}>
                <option value="">Auto</option>
                {CAMERA[key].options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {built && shot.prompt.trim() ? (
          <details className="final-prompt">
            <summary>Prompt that will be sent</summary>
            <p>{built.prompt}</p>
          </details>
        ) : null}
      </div>

      <aside className="editor__side">
        <label className="field">
          <span className="field__label">Model</span>
          <select value={shot.modelKey} onChange={(e) => onChange({ modelKey: e.target.value, params: {}, customEndpoint: undefined })}>
            <optgroup label="Free — Spaces & your own GPU">
              {MODELS.filter((m) => m.free).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} · {m.maker}
                </option>
              ))}
              <option value={SPACE_KEY}>Any Space, or your own GPU…</option>
            </optgroup>
            <optgroup label="Paid — fal.ai (your key)">
              {MODELS.filter((m) => !m.free).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} · {m.maker}
                </option>
              ))}
              <option value={CUSTOM_KEY}>Custom fal endpoint…</option>
            </optgroup>
          </select>
        </label>

        {shot.modelKey === SPACE_KEY ? (
          <label className="field">
            <span className="field__label">Space or studio URL</span>
            <input
              className="mono"
              value={shot.customEndpoint ?? ""}
              onChange={(e) => onChange({ customEndpoint: e.target.value, params: {} })}
              placeholder="Lightricks/ltx-video-distilled — or https://xxxx.gradio.live"
              spellCheck={false}
            />
            <span className="field__hint">
              A running video Space from{" "}
              <a href="https://huggingface.co/spaces?category=video-generation" target="_blank" rel="noreferrer">
                huggingface.co/spaces
              </a>
              , or the share link of a Shotloom studio you are running yourself — on a free Kaggle or Colab GPU,
              a rented one, or your own PC. No daily quota on your own GPU. Shotloom reads whichever it is and
              builds the settings below.
            </span>
          </label>
        ) : shot.modelKey === CUSTOM_KEY ? (
          <label className="field">
            <span className="field__label">Endpoint ID</span>
            <input
              className="mono"
              value={shot.customEndpoint ?? ""}
              onChange={(e) => onChange({ customEndpoint: e.target.value, params: {} })}
              placeholder="e.g. fal-ai/kling-video/o3/pro/text-to-video"
              spellCheck={false}
            />
            <span className="field__hint">
              Any video model from{" "}
              <a href="https://fal.ai/explore/text-to-video-apis" target="_blank" rel="noreferrer">
                fal.ai/explore
              </a>
              . Its settings load automatically.
            </span>
          </label>
        ) : model ? (
          <p className="model-blurb">
            {model.blurb}
            {model.price ? <span className="mono"> {model.price}</span> : null}
          </p>
        ) : null}

        {choice.endpoint ? (
          <p className="endpoint mono">
            <span className={"mode-chip mode-chip--" + (choice.mode ?? "custom")}>
              {choice.mode === "image" ? "image → video" : choice.mode === "reference" ? "ingredients → video" : choice.mode === "text" ? "text → video" : "custom"}
            </span>
            {choice.endpoint}
          </p>
        ) : null}

        {schema ? (
          <>
            {schema.fallback ? <p className="warn">Couldn&apos;t load this model&apos;s full settings, using a minimal form. ({schemaError})</p> : null}
            <ParamControls
              fields={schema.fields}
              values={shot.params}
              autoValues={auto}
              onChange={(name, v) => {
                const params = { ...shot.params };
                if (v === undefined) delete params[name];
                else params[name] = v;
                onChange({ params });
              }}
            />
          </>
        ) : choice.endpoint && !schemaError ? (
          <p className="dim">Loading model settings…</p>
        ) : null}

        {built?.notes.length ? (
          <ul className="notes">
            {built.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        <div className="generate">
          {problems.length ? <p className="problem">{problems[0]}</p> : null}
          {!ready && !free ? (
            <button className="btn btn--primary btn--big" onClick={onOpenSettings}>
              <Icon name="key" /> Add fal key to generate
            </button>
          ) : (
            <div className="generate__row">
              <label className="count" title="How many takes to render at once">
                <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of takes">
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      ×{n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn btn--primary btn--big"
                disabled={!canGenerate}
                onClick={() => {
                  const p = plan();
                  if (p) onGenerate(p, count);
                }}
              >
                <Icon name="spark" /> Generate {count > 1 ? `${count} takes` : "take"}
              </button>
            </div>
          )}
          <p className="dim small">
            Ctrl/⌘ + Enter in the prompt also generates.{" "}
            {free
              ? "This model is free: each take spends a little of your daily Hugging Face GPU quota."
              : "Each take is billed by fal."}
          </p>
        </div>
      </aside>
    </section>
  );
}
