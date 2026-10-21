"use client";
import { useEffect, useRef, useState } from "react";
import { exportFilm, type ExportProgress } from "@/lib/export";
import { downloadUrl, slug } from "@/lib/media";
import { Modal } from "./Modal";

export function ExportDialog({ clipUrls, name, onClose }: { clipUrls: string[]; name: string; onClose: () => void }) {
  const [progress, setProgress] = useState<ExportProgress>({ stage: "Starting…", value: 0 });
  const [result, setResult] = useState<{ url: string; warning?: string; size: number }>();
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    exportFilm(clipUrls, setProgress)
      .then(({ blob, warning }) => setResult({ url: URL.createObjectURL(blob), warning, size: blob.size }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [clipUrls]);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  return (
    <Modal title="Export film" onClose={onClose} wide>
      {error ? (
        <div className="export">
          <p className="problem">Export failed: {error}</p>
          <p className="dim">You can still download each take from its card and join them in CapCut or any editor.</p>
        </div>
      ) : result ? (
        <div className="export">
          <video src={result.url} controls playsInline />
          {result.warning ? <p className="warn">{result.warning}</p> : null}
          <div className="export__row">
            <span className="mono dim">{(result.size / 1024 / 1024).toFixed(1)} MB · {clipUrls.length} shots</span>
            <button className="btn btn--primary" onClick={() => downloadUrl(result.url, `${slug(name)}.mp4`)}>
              Download MP4
            </button>
          </div>
        </div>
      ) : (
        <div className="export">
          <p>{progress.stage}</p>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress.value * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(progress.value * 100)}%` }} />
          </div>
          <p className="dim small">Runs in your browser. Keep this tab open; clips in different formats take longer.</p>
        </div>
      )}
    </Modal>
  );
}
