import React, { useState, useMemo } from 'react';

const HISTORY_KEY = 'arcade_arena_history';
const RUNS_KEY    = 'arcade_arena_runs';
const PB_KEY      = 'arcade_arena_pb';

// ─── SVG chart constants ────────────────────────────────────────────────────
const SVG_W  = 560;
const SVG_H  = 170;
const PAD_L  = 46;   // room for y-axis labels
const PAD_R  = 12;
const PAD_T  = 16;
const PAD_B  = 30;   // room for x-axis date labels
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;

// Map a day index (0 = oldest) to SVG x pixel
const xForIdx = (i, total) => PAD_L + (total <= 1 ? PLOT_W / 2 : (i / (total - 1)) * PLOT_W);

// Map a score value to SVG y pixel (higher score = lower y)
const yForScore = (score, yBottom, yTop) =>
  PAD_T + PLOT_H - ((score - yBottom) / Math.max(yTop - yBottom, 1)) * PLOT_H;

// Build an SVG path string with gap support (null entries lift the pen)
const buildPath = (points) => {
  let d = '';
  let penDown = false;
  points.forEach((pt) => {
    if (pt.score === null) { penDown = false; return; }
    const x = pt.px.toFixed(1);
    const y = pt.py.toFixed(1);
    d += penDown ? `L${x},${y} ` : `M${x},${y} `;
    penDown = true;
  });
  return d.trim();
};

// ─── helpers ────────────────────────────────────────────────────────────────

const readHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
  catch { return {}; }
};

const readRuns = () => {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]'); }
  catch { return []; }
};

// Returns array of { dateStr, label, score|null } for the last N days, oldest first
const buildChartDays = (history, days = 14) => {
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d   = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().split('T')[0];
    const lbl = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const entry = history[key];
    result.push({ key, label: lbl, score: entry ? entry.score : null, games: entry ? entry.games : 0 });
  }
  return result;
};

// ─── LineChart component ────────────────────────────────────────────────────

function LineChart({ days }) {
  const [hovered, setHovered] = useState(null); // index of hovered dot

  const scores  = days.map((d) => d.score).filter((s) => s !== null);
  const hasData = scores.length > 0;

  const maxScore = hasData ? Math.max(...scores) : 100;
  const minScore = hasData ? Math.min(...scores) : 0;
  const range    = Math.max(maxScore - minScore, 60);
  const yTop     = maxScore + range * 0.12;
  const yBottom  = Math.max(0, minScore - range * 0.08);

  const points = days.map((d, i) => ({
    ...d,
    px: xForIdx(i, days.length),
    py: d.score !== null ? yForScore(d.score, yBottom, yTop) : null,
  }));

  const pathD = buildPath(points);

  // 4 evenly-spaced y-axis gridlines
  const yTicks = [0, 1, 2, 3].map((i) => {
    const val = yBottom + (i / 3) * (yTop - yBottom);
    return { val: Math.round(val), py: yForScore(val, yBottom, yTop) };
  });

  // X-axis labels every 2 days, always show last
  const xLabels = points.filter((_, i) => i % 2 === 0 || i === days.length - 1);

  if (!hasData) {
    return (
      <div className="chart-empty-state">
        <p>Play a few games to see your performance chart.</p>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {hovered !== null && points[hovered]?.score !== null && (
        <div
          className="chart-tooltip"
          style={{
            left: `calc(${((points[hovered].px - PAD_L) / PLOT_W) * 100}% + ${PAD_L}px)`,
          }}
        >
          <span className="chart-tooltip__score">{points[hovered].score}</span>
          <span className="chart-tooltip__date">{points[hovered].label}</span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="stats-chart"
        role="img"
        aria-label="Line chart of daily best scores"
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#7cf3c5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#7cf3c5" stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Y-axis gridlines + labels */}
        {yTicks.map(({ val, py }) => (
          <g key={val}>
            <line
              x1={PAD_L} y1={py.toFixed(1)}
              x2={SVG_W - PAD_R} y2={py.toFixed(1)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1"
            />
            <text
              x={(PAD_L - 6).toFixed(1)} y={py.toFixed(1)}
              textAnchor="end" dominantBaseline="middle"
              className="chart-axis-label"
            >{val}</text>
          </g>
        ))}

        {/* Area fill under the line */}
        {pathD && (
          <path
            d={`${pathD} L${(points.filter(p => p.score !== null).at(-1)?.px ?? 0).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} L${(points.find(p => p.score !== null)?.px ?? 0).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} Z`}
            fill="url(#areaGrad)"
          />
        )}

        {/* Line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#7cf3c5"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dots — interactive */}
        {points.map((pt, i) => pt.score !== null && (
          <g key={pt.key}>
            <circle
              cx={pt.px.toFixed(1)} cy={pt.py.toFixed(1)}
              r="5"
              fill={i === hovered ? '#7cf3c5' : '#0b0f17'}
              stroke="#7cf3c5"
              strokeWidth="2.5"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          </g>
        ))}

        {/* X-axis date labels */}
        {xLabels.map((pt) => (
          <text
            key={`xl-${pt.key}`}
            x={pt.px.toFixed(1)}
            y={(SVG_H - 4).toFixed(1)}
            textAnchor="middle"
            className="chart-axis-label"
          >{pt.label}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── StatsPage ───────────────────────────────────────────────────────────────

function StatsPage() {
  const history     = useMemo(readHistory, []);
  const runs        = useMemo(readRuns,    []);
  const allTimeBest = parseInt(localStorage.getItem(PB_KEY) || '0', 10);

  const [chartDays, setChartDays] = useState(14);
  const days = useMemo(() => buildChartDays(history, chartDays), [history, chartDays]);

  // ── Summary stats ────────────────────────────────────────────────────────
  const totalGames = useMemo(() => {
    return Object.values(history).reduce((sum, v) => sum + (v.games || 0), 0);
  }, [history]);

  const last7Runs = useMemo(
    () => runs.filter((r) => Date.now() - r.timestamp <= 7 * 86_400_000),
    [runs]
  );
  const avg7 = last7Runs.length > 0
    ? Math.round(last7Runs.reduce((s, r) => s + r.score, 0) / last7Runs.length)
    : null;

  const bestReaction = useMemo(
    () => runs.reduce((best, r) => {
      if (r.fastestHit == null) return best;
      return best == null ? r.fastestHit : Math.min(best, r.fastestHit);
    }, null),
    [runs]
  );

  // ── Trend analysis ───────────────────────────────────────────────────────
  const { trend, avgAccuracy, avgReaction } = useMemo(() => {
    const chronoRuns = [...runs].reverse(); // oldest first
    const half       = Math.floor(chronoRuns.length / 2);
    const firstAvg   = half > 0
      ? chronoRuns.slice(0, half).reduce((s, r) => s + r.score, 0) / half
      : null;
    const secondAvg  = (chronoRuns.length - half) > 0
      ? chronoRuns.slice(half).reduce((s, r) => s + r.score, 0) / (chronoRuns.length - half)
      : null;

    let trendLabel = 'Not enough data';
    if (firstAvg !== null && secondAvg !== null && chronoRuns.length >= 4) {
      const delta = secondAvg - firstAvg;
      if (delta > 15)       trendLabel = 'Improving';
      else if (delta < -15) trendLabel = 'Declining';
      else                  trendLabel = 'Consistent';
    }

    const recent10   = runs.slice(0, 10);
    const accValid   = recent10.filter((r) => r.accuracy   != null);
    const reactValid = recent10.filter((r) => r.avgReaction != null);

    return {
      trend:       trendLabel,
      avgAccuracy: accValid.length   > 0 ? Math.round(accValid.reduce((s, r)   => s + r.accuracy,    0) / accValid.length)   : null,
      avgReaction: reactValid.length > 0 ? Math.round(reactValid.reduce((s, r) => s + r.avgReaction, 0) / reactValid.length) : null,
    };
  }, [runs]);

  const trendKey = trend === 'Improving' ? 'up' : trend === 'Declining' ? 'down' : 'flat';

  // Speed category label
  const reactionLabel = (ms) => {
    if (ms == null) return null;
    if (ms < 150)  return 'Elite';
    if (ms < 250)  return 'Fast';
    if (ms < 350)  return 'Good';
    if (ms < 500)  return 'Average';
    return 'Warming up';
  };

  return (
    <div className="stats-page">
      <h2 className="stats-page__title">Performance</h2>

      {/* ── Summary chips ── */}
      <div className="stats-row stats-row--wrap">
        <div className="stat-chip">
          <span className="stat-chip__label">All-time best</span>
          <span className="stat-chip__value">{allTimeBest || '—'}</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip__label">Avg (7 days)</span>
          <span className="stat-chip__value">{avg7 ?? '—'}</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip__label">Total games</span>
          <span className="stat-chip__value">{totalGames || '—'}</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip__label">Best snap</span>
          <span className="stat-chip__value">
            {bestReaction != null ? `${bestReaction} ms` : '—'}
          </span>
        </div>
      </div>

      {/* ── Line chart ── */}
      <div className="stats-chart-card">
        <div className="stats-chart-header">
          <p className="stats-section-label" style={{ margin: 0 }}>Daily best score</p>
          <div className="segmented">
            <button className={chartDays === 14 ? 'active' : ''} onClick={() => setChartDays(14)}>14d</button>
            <button className={chartDays === 30 ? 'active' : ''} onClick={() => setChartDays(30)}>30d</button>
          </div>
        </div>
        <LineChart days={days} />
      </div>

      {/* ── Trend analysis ── */}
      <div className="stats-trend-card">
        <p className="stats-section-label">Trend analysis</p>

        <div className="stats-trend-row">
          <span className="stats-trend-label">Performance trajectory</span>
          <span className={`stats-trend-badge stats-trend-badge--${trendKey}`}>{trend}</span>
        </div>

        <div className="stats-trend-row">
          <span className="stats-trend-label">Avg accuracy (recent 10 runs)</span>
          <span className="stats-trend-value">{avgAccuracy != null ? `${avgAccuracy}%` : '—'}</span>
        </div>

        <div className="stats-trend-row">
          <span className="stats-trend-label">Avg reaction (recent 10 runs)</span>
          <span className="stats-trend-value">
            {avgReaction != null ? (
              <>{avgReaction} ms <span className="reaction-label">{reactionLabel(avgReaction)}</span></>
            ) : '—'}
          </span>
        </div>

        <div className="stats-trend-row">
          <span className="stats-trend-label">Best snap ever</span>
          <span className="stats-trend-value">
            {bestReaction != null ? (
              <>{bestReaction} ms <span className="reaction-label">{reactionLabel(bestReaction)}</span></>
            ) : '—'}
          </span>
        </div>
      </div>

      {/* ── Recent runs table ── */}
      <div className="stats-runs-card">
        <p className="stats-section-label">Recent runs</p>
        {runs.length === 0 ? (
          <p className="muted" style={{ padding: '16px 0', textAlign: 'center' }}>
            No runs recorded yet. Play a game!
          </p>
        ) : (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Mode</th>
                  <th>Score</th>
                  <th>Accuracy</th>
                  <th>Best snap</th>
                  <th>Streak</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, idx) => (
                  <tr key={`${run.timestamp}-${idx}`}>
                    <td>
                      {new Date(run.timestamp).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td>
                      <span className={`diff-badge diff-badge--${run.difficulty}`}>
                        {run.difficulty}
                      </span>
                    </td>
                    <td className="stats-table__score">{run.score}</td>
                    <td>{run.accuracy != null ? `${run.accuracy}%` : '—'}</td>
                    <td>{run.fastestHit != null ? `${run.fastestHit} ms` : '—'}</td>
                    <td>{run.maxStreak ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StatsPage;
