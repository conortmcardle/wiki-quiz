import type { BreakdownRow } from "../lib/results/analyze";

interface Row extends BreakdownRow {
  /** Accuracy on the previous comparable attempt, if any. */
  previousPct?: number;
}

interface Props {
  title: string;
  rows: Row[];
  /** Flag rows below the weak threshold with the warning style + label. */
  flagWeak?: boolean;
}

const fmtPct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Single-series horizontal "meter" bars: each row is a ratio against 100%,
 * so the bar sits on a lighter track of the same hue. Values are written as
 * text on every row (the list doubles as the table view); the bars are
 * decoration for sighted readers and hidden from screen readers.
 */
export function MeterChart({ title, rows, flagWeak = false }: Props) {
  return (
    <figure className="meter-chart">
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="meter-rows">
        {rows.map((r) => {
          const weak = flagWeak && r.weak;
          const delta = r.previousPct === undefined ? null : Math.round((r.pct - r.previousPct) * 100);
          return (
            <li
              key={r.id}
              className={`meter-row ${weak ? "is-weak" : ""}`}
              title={`${r.label}: ${r.correct} of ${r.total} correct (${fmtPct(r.pct)})${
                r.previousPct !== undefined ? `, last time ${fmtPct(r.previousPct)}` : ""
              }`}
            >
              <div className="meter-label">
                <span className="meter-name">
                  {weak && (
                    <span className="weak-badge">
                      <span aria-hidden="true">⚠</span> Brush up
                    </span>
                  )}
                  {r.label}
                </span>
                <span className="meter-value">
                  <strong>
                    {r.correct}/{r.total}
                  </strong>{" "}
                  <span className="muted">{fmtPct(r.pct)}</span>
                  {delta !== null && delta !== 0 && (
                    <span className={`delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
                      {" "}
                      <span aria-hidden="true">{delta > 0 ? "▲" : "▼"}</span>
                      <span className="visually-hidden">{delta > 0 ? "up" : "down"}</span> {Math.abs(delta)}
                    </span>
                  )}
                </span>
              </div>
              <div className="meter-track" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${Math.max(r.pct * 100, r.pct > 0 ? 2 : 0)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
