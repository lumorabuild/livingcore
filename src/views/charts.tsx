/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SERVER-RENDERED INLINE SVG CHARTS for /lab — no client chart library, per
// spec §10 ("server-rendered inline SVG"). A small generic line chart plus a
// convenience multi-series wrapper is all /lab needs.
// ─────────────────────────────────────────────────────────────────────────────

export interface Series {
  label: string;
  color: string;
  points: (number | null)[];
}

const W = 640;
const H = 200;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 24;

export function LineChart({ series, xLabels, yMax, yFormat, annotate }: {
  series: Series[];
  xLabels: string[];
  yMax?: number;
  yFormat?: (v: number) => string;
  annotate?: { index: number; text: string }[];
}) {
  const n = xLabels.length;
  const allVals = series.flatMap((s) => s.points.filter((v): v is number => v !== null));
  const max = yMax ?? (allVals.length ? Math.max(...allVals) * 1.15 : 1);
  const min = 0;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xAt = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD_T + plotH - ((v - min) / (max - min || 1)) * plotH;

  const fmt = yFormat || ((v: number) => v.toFixed(2));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map((s) => s.label).join(', ')}>
      {/* gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <line key={i} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - f)} y2={PAD_T + plotH * (1 - f)} stroke="var(--border)" stroke-width="1" />
      ))}
      <text x={2} y={PAD_T + plotH + 4} font-size="9" fill="var(--muted)">0</text>
      <text x={2} y={PAD_T + 8} font-size="9" fill="var(--muted)">{fmt(max)}</text>

      {series.map((s, si) => {
        const segs: string[] = [];
        let cur = '';
        s.points.forEach((v, i) => {
          if (v === null) { if (cur) { segs.push(cur); cur = ''; } return; }
          cur += `${cur ? 'L' : 'M'} ${xAt(i)} ${yAt(v)} `;
        });
        if (cur) segs.push(cur);
        return (
          <g key={si}>
            {segs.map((d, di) => <path key={di} d={d} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />)}
            {s.points.map((v, i) => v === null ? null : <circle key={i} cx={xAt(i)} cy={yAt(v)} r="2.4" fill={s.color} />)}
          </g>
        );
      })}

      {annotate?.map((a, i) => (
        <g key={i}>
          <line x1={xAt(a.index)} x2={xAt(a.index)} y1={PAD_T} y2={PAD_T + plotH} stroke="var(--gold)" stroke-width="1" stroke-dasharray="3,3" />
          <text x={xAt(a.index) + 4} y={PAD_T + 10} font-size="9" fill="var(--gold)">{a.text}</text>
        </g>
      ))}

      {xLabels.map((l, i) => (
        (n <= 10 || i === 0 || i === n - 1 || i % Math.ceil(n / 8) === 0) ? (
          <text key={i} x={xAt(i)} y={H - 6} font-size="9" fill="var(--muted)" text-anchor="middle">{l}</text>
        ) : null
      ))}
    </svg>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
      {series.map((s, i) => (
        <span key={i} style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);">
          <span style={`width:9px;height:9px;border-radius:50%;background:${s.color};display:inline-block;`}></span>{s.label}
        </span>
      ))}
    </div>
  );
}
