import { useState } from "react";
import { pct } from "../lib/results/analyze";
import { categoryTrend, type ArticleHistory, type AttemptSummary } from "../lib/storage/history";

interface Props {
  history: ArticleHistory;
  /** Id of the attempt just finished, highlighted in the chart. */
  currentId?: string;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function heatBin(p: number): number {
  if (p >= 1) return 5;
  if (p >= 0.8) return 4;
  if (p >= 0.6) return 3;
  if (p >= 0.4) return 2;
  return 1;
}

/** Overall score per attempt (single-series line) + per-category grid. */
export function ProgressHistory({ history, currentId }: Props) {
  const trend = categoryTrend(history);
  if (trend.attempts.length < 2) return null;
  const { attempts, rows } = trend;
  // Number attempts across the whole history, not just the visible window.
  const firstNumber = history.attempts.filter((x) => x.mode !== "retry-missed").length - attempts.length + 1;

  return (
    <section className="card" aria-labelledby="progress-title">
      <h2 id="progress-title" className="section-title">
        Your progress on this article
      </h2>
      <p className="muted small section-sub">
        Your last {attempts.length} quizzes on this article. Retry rounds aren't counted.
      </p>

      <ScoreLine attempts={attempts} firstNumber={firstNumber} currentId={currentId} />

      <div className="table-scroll">
        <table className="trend-table">
          <caption className="visually-hidden">Score by category for each attempt</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              {attempts.map((a, i) => (
                <th scope="col" key={a.id} className={a.id === currentId ? "is-current" : ""}>
                  #{firstNumber + i}
                  <span className="th-date">{fmtDate(a.date)}</span>
                </th>
              ))}
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const seen = row.cells.filter((c): c is NonNullable<typeof c> => c !== null);
              const first = seen[0];
              const last = seen[seen.length - 1];
              const change = first && last && seen.length > 1 ? Math.round((pct(last) - pct(first)) * 100) : null;
              return (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  {row.cells.map((c, i) => (
                    <td key={attempts[i]!.id} className={c ? `heat heat-${heatBin(pct(c))}` : "heat-empty"}>
                      {c ? `${Math.round(pct(c) * 100)}%` : "–"}
                      {c && <span className="visually-hidden"> ({c.correct} of {c.total})</span>}
                    </td>
                  ))}
                  <td className="change-cell">
                    {change === null ? (
                      <span className="muted">–</span>
                    ) : change === 0 ? (
                      <span className="muted">±0</span>
                    ) : (
                      <span className={change > 0 ? "delta-up" : "delta-down"}>
                        <span aria-hidden="true">{change > 0 ? "▲" : "▼"}</span>
                        <span className="visually-hidden">{change > 0 ? "up" : "down"}</span> {Math.abs(change)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small heat-legend">
        <span className="heat-key heat-1" aria-hidden="true" /> under 40%
        <span className="heat-key heat-3" aria-hidden="true" /> 60–79%
        <span className="heat-key heat-5" aria-hidden="true" /> 100%
        <span> · Change is first to latest attempt, in percentage points.</span>
      </p>
    </section>
  );
}

function ScoreLine({
  attempts,
  firstNumber,
  currentId,
}: {
  attempts: AttemptSummary[];
  firstNumber: number;
  currentId?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 160;
  const pad = { l: 36, r: 40, t: 14, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (attempts.length === 1 ? innerW / 2 : (i / (attempts.length - 1)) * innerW);
  const y = (p: number) => pad.t + (1 - p) * innerH;
  const points = attempts.map((a, i) => ({ a, i, p: a.total ? a.correct / a.total : 0 }));
  const path = points.map(({ i, p }, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const active = hover !== null ? points[hover] : null;

  return (
    <figure className="line-chart">
      <figcaption className="chart-title">Overall score</figcaption>
      <div className="line-chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Overall score by attempt: ${points.map(({ i, p }) => `#${firstNumber + i} ${Math.round(p * 100)}%`).join(", ")}`}>
          {[0, 0.5, 1].map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="grid-line" />
              <text x={pad.l - 8} y={y(g) + 4} className="axis-label" textAnchor="end">
                {g * 100}%
              </text>
            </g>
          ))}
          {points.map(({ a, i }) => (
            <text key={a.id} x={x(i)} y={H - 6} className="axis-label" textAnchor="middle">
              #{firstNumber + i}
            </text>
          ))}
          <path d={path} className="score-line" />
          {active && <line x1={x(active.i)} x2={x(active.i)} y1={pad.t} y2={pad.t + innerH} className="crosshair" />}
          {points.map(({ a, i, p }) => (
            <g key={a.id}>
              <circle cx={x(i)} cy={y(p)} r={a.id === currentId ? 6 : 4.5} className={`score-dot ${a.id === currentId ? "is-current" : ""}`} />
              {/* generous invisible hit target */}
              <rect
                x={x(i) - 18}
                y={pad.t - 6}
                width={36}
                height={innerH + 12}
                className="hit"
                tabIndex={0}
                aria-label={`Attempt ${firstNumber + i}, ${fmtDateTime(a.date)}: ${a.correct} of ${a.total} (${Math.round(p * 100)}%)`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          ))}
          <text x={x(last.i) + 10} y={y(last.p) + 4} className="end-label">
            {Math.round(last.p * 100)}%
          </text>
        </svg>
        {active && (
          <div
            className="chart-tooltip"
            style={{ left: `${(x(active.i) / W) * 100}%`, top: `${(y(active.p) / H) * 100}%` }}
            role="status"
          >
            <strong>
              {active.a.correct}/{active.a.total} · {Math.round(active.p * 100)}%
            </strong>
            <span>
              #{firstNumber + active.i} · {fmtDateTime(active.a.date)}
              {active.a.mode === "focus" ? " · weak-area practice" : ""}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}
