import type { GenerationProgress } from "../lib/quiz/generate";

interface Props {
  title: string;
  progress: GenerationProgress;
  model: string;
  onCancel: () => void;
}

const STEPS: GenerationProgress["phase"][] = ["categories", "questions", "checking"];
const STEP_LABELS = { categories: "Choose topic categories", questions: "Write questions", checking: "Check against the article" };

export function GeneratingView({ title, progress, model, onCancel }: Props) {
  const current = STEPS.indexOf(progress.phase);
  return (
    <div className="card loading-card generating" aria-live="polite" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <h2 className="generating-title">Building your quiz on {title}</h2>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step} className={i < current ? "done" : i === current ? "active" : ""}>
            {STEP_LABELS[step]}
            {step === "questions" && i === current && progress.total && progress.total > 1
              ? ` (${progress.done ?? 0}/${progress.total})`
              : ""}
          </li>
        ))}
      </ol>
      <p className="muted small">{progress.message}</p>
      <p className="muted small">
        Using <code>{model}</code>. This usually takes 20–60 seconds.
      </p>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
