"use client";
import { useRef, useState } from "react";
import { compressImage } from "@/lib/media";
import { uid, type Character } from "@/lib/types";
import { Icon } from "./Icon";

/** Reusable reference images: the way to keep a person, mascot or object the same across clips. */
export function CharactersView({
  characters,
  onChange,
  onUse,
  onNotice,
}: {
  characters: Character[];
  onChange: (next: Character[]) => void;
  onUse: (c: Character, as: "ingredient" | "start") => void;
  onNotice: (t: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | File[] | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: Character[] = [];
      for (const f of Array.from(files)) {
        added.push({ id: uid("c_"), name: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || "Character", image: await compressImage(f, 1280, 0.86) });
      }
      onChange([...characters, ...added]);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="characters"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        add(e.dataTransfer.files);
      }}
    >
      <p className="view-intro">
        Save a character once, then reuse it in any prompt from the <strong>+</strong> menu. Veo 3.1 uses characters as
        ingredients; other models start the clip from the image.
      </p>
      <div className="char-grid">
        <button className="char char--add" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name="plus" size={28} />
          <span>{busy ? "Adding…" : "Add character"}</span>
          <span className="dim small">Drop or pick images</span>
        </button>
        {characters.map((c) => (
          <figure key={c.id} className="char">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.image} alt={c.name} />
            <figcaption>
              <input
                value={c.name}
                aria-label="Character name"
                onChange={(e) => onChange(characters.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              />
              <span className="char__tools">
                <button className="btn btn--sm" onClick={() => onUse(c, "ingredient")}>
                  Ingredient
                </button>
                <button className="btn btn--sm" onClick={() => onUse(c, "start")}>
                  Start frame
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${c.name}?`)) onChange(characters.filter((x) => x.id !== c.id));
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
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
