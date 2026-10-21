"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

export function FilmPlayer({
  clips,
  onClose,
}: {
  clips: { url: string; label: string }[];
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const clip = clips[i];

  useEffect(() => {
    video.current?.play().catch(() => undefined);
  }, [i]);

  return (
    <Modal title="Film preview" onClose={onClose} wide>
      <div className="player">
        {clip ? (
          <video
            ref={video}
            key={clip.url}
            src={clip.url}
            controls
            autoPlay
            playsInline
            onEnded={() => setI((n) => (n + 1 < clips.length ? n + 1 : n))}
          />
        ) : null}
        <div className="player__bar">
          {clips.map((c, n) => (
            <button key={n} className={"player__seg" + (n === i ? " is-on" : n < i ? " is-past" : "")} onClick={() => setI(n)}>
              <span className="mono">{String(n + 1).padStart(2, "0")}</span> {c.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
