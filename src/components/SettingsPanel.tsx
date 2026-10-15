import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DEFAULT_MODEL, maskApiKey, type Settings } from "../lib/storage/settings";

export const MODEL_PRESETS: { id: string; label: string; note: string }[] = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Default: fast, high quality" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "More thorough, about 2× the cost" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Most capable, much slower and pricier" },
];

interface Props {
  open: boolean;
  /** Why the panel was opened (e.g. "Add your API key to generate a quiz"). */
  reason?: string;
  apiKey: string;
  settings: Settings;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function SettingsPanel({ open, reason, apiKey, settings, onSaveKey, onClearKey, onChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(
    MODEL_PRESETS.some((m) => m.id === settings.model) ? "" : settings.model,
  );
  const ids = { key: useId(), model: useId(), custom: useId(), fallback: useId() };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraftKey("");
      setKeyError(null);
      setShowKey(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    const key = draftKey.trim();
    if (!key) {
      setKeyError("Paste your API key first.");
      return;
    }
    if (!key.startsWith("sk-ant-")) {
      setKeyError("Anthropic API keys start with “sk-ant-”. Check you copied the whole key.");
      return;
    }
    onSaveKey(key);
    setDraftKey("");
    setKeyError(null);
  };

  const isPreset = MODEL_PRESETS.some((m) => m.id === settings.model);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose(); // click on backdrop
      }}
    >
      <div className="settings-body">
        <div className="settings-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </div>

        {reason && (
          <p className="notice notice-info" role="status">
            {reason}
          </p>
        )}

        <section className="settings-section" aria-labelledby={`${ids.key}-h`}>
          <h3 id={`${ids.key}-h`}>Anthropic API key</h3>
          {apiKey ? (
            <div className="key-saved">
              <p>
                Saved key: <code>{maskApiKey(apiKey)}</code>
              </p>
              <button type="button" className="btn btn-danger btn-small" onClick={onClearKey}>
                Clear key
              </button>
            </div>
          ) : (
            <p className="muted small">
              No key saved yet. Create one in the{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                Claude Console
              </a>
              .
            </p>
          )}

          <form onSubmit={saveKey} className="key-form" noValidate>
            <label htmlFor={ids.key} className="field-label">
              {apiKey ? "Replace key" : "Paste your key"}
            </label>
            <div className="input-row">
              <input
                id={ids.key}
                className="text-input"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={draftKey}
                onChange={(e) => {
                  setDraftKey(e.target.value);
                  setKeyError(null);
                }}
                aria-invalid={keyError ? true : undefined}
                aria-describedby={`${ids.key}-help`}
              />
              <button type="button" className="btn btn-ghost" onClick={() => setShowKey((s) => !s)}>
                {showKey ? "Hide" : "Show"}
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
            {keyError && (
              <p className="field-error" role="alert">
                {keyError}
              </p>
            )}
            <p id={`${ids.key}-help`} className="field-hint">
              Your key is stored only in this browser (localStorage) and is sent only to api.anthropic.com
              when you generate a quiz. It is never sent anywhere else or saved on any server. Anyone who
              can use this browser profile can read it, so clear it on shared computers.
            </p>
          </form>
        </section>

        <section className="settings-section" aria-labelledby={`${ids.model}-h`}>
          <h3 id={`${ids.model}-h`}>Model</h3>
          <div className="model-options" role="radiogroup" aria-labelledby={`${ids.model}-h`}>
            {MODEL_PRESETS.map((m) => (
              <label key={m.id} className={`model-option ${settings.model === m.id ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={settings.model === m.id}
                  onChange={() => onChange({ model: m.id })}
                />
                <span>
                  <strong>{m.label}</strong>
                  <span className="muted small"> · {m.note}</span>
                  <code className="model-id">{m.id}</code>
                </span>
              </label>
            ))}
            <label className={`model-option ${!isPreset ? "selected" : ""}`}>
              <input
                type="radio"
                name="model"
                value="custom"
                checked={!isPreset}
                onChange={() => onChange({ model: customModel.trim() || DEFAULT_MODEL })}
              />
              <span className="custom-model">
                <strong>Other model ID</strong>
                <input
                  id={ids.custom}
                  className="text-input"
                  type="text"
                  spellCheck={false}
                  placeholder="e.g. claude-sonnet-5"
                  value={customModel}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    if (e.target.value.trim()) onChange({ model: e.target.value.trim() });
                  }}
                  aria-label="Custom model ID"
                />
              </span>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h3>Refusal fallback</h3>
          <label className="check-row" htmlFor={ids.fallback}>
            <input
              id={ids.fallback}
              type="checkbox"
              checked={settings.refusalFallback}
              onChange={(e) => onChange({ refusalFallback: e.target.checked })}
            />
            <span>
              If the model declines a request (rare for encyclopedia content), let Anthropic re-run it on its
              recommended fallback model instead of failing.
            </span>
          </label>
        </section>
      </div>
    </dialog>
  );
}
