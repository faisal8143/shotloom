"use client";
import { useState } from "react";
import { credentials } from "@/lib/client-api";
import { Modal } from "./Modal";

export function SettingsDialog({
  serverKey,
  onClose,
  onSaved,
}: {
  serverKey: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(credentials.key);
  const [pass, setPass] = useState(credentials.pass);
  const [show, setShow] = useState(false);

  return (
    <Modal title="Settings" onClose={onClose}>
      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault();
          credentials.save(key, pass);
          onSaved();
          onClose();
        }}
      >
        <label className="field">
          <span className="field__label">Your fal.ai API key</span>
          <div className="input-row">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="paste key here"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="btn btn--ghost" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          <span className="field__hint">
            Create one at{" "}
            <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
              fal.ai/dashboard/keys
            </a>
            . The key stays in this browser and is only forwarded to fal when you generate. You pay fal directly,
            per second of video, from the credit on your fal account.
          </span>
        </label>

        {serverKey ? (
          <label className="field">
            <span className="field__label">…or the studio password</span>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="password set by whoever deployed this studio"
              autoComplete="current-password"
            />
            <span className="field__hint">This deployment has its own fal key. Leave your key empty to use it.</span>
          </label>
        ) : null}

        <div className="settings__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
