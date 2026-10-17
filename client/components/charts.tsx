/**
 * Shared chart pieces (Recharts). One y-axis per chart; session entries are solid
 * markers, self check-ins are hollow markers so the two sources stay distinguishable.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import type { ReactNode } from 'react';
import { CATEGORY_META, type RatingCategory } from '@shared/care';
import { fmtDate, fmtDateTime } from '@/lib/format';

export interface TrendPoint {
  at: string; // ISO
  value: number;
  source: 'session' | 'self';
  isPrivate?: boolean;
  note?: string | null;
  label?: string;
}

const ts = (iso: string) => new Date(iso).getTime();

function TipBox({ children }: { children: ReactNode }) {
  return <div className="chart-tip">{children}</div>;
}

export function TrendChart({ points, max = 10, color, height = 240, unit = '', emptyLabel = 'No entries yet', showGrid = true, highlightAt }: {
  points: TrendPoint[];
  max?: 10 | 100;
  color: string;
  height?: number;
  unit?: string;
  emptyLabel?: string;
  showGrid?: boolean;
  /** ISO timestamp to mark with a vertical reference line (e.g. "today" or selected session). */
  highlightAt?: string | null;
}) {
  if (!points.length) return <div className="empty" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{emptyLabel}</div>;
  const data = [...points].sort((a, b) => ts(a.at) - ts(b.at)).map((p) => ({ ...p, t: ts(p.at) }));
  const domain: [number, number] = [data[0]!.t - 86400000 * 3, Math.max(data[data.length - 1]!.t, Date.now()) + 86400000 * 3];
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: max === 100 || unit ? -2 : -16 }}>
          {showGrid && <CartesianGrid stroke="var(--grid)" vertical={false} />}
          <XAxis dataKey="t" type="number" domain={domain} scale="time" tickFormatter={(v: number) => fmtDate(new Date(v).toISOString())} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={36} />
          <YAxis domain={[0, max]} ticks={max === 10 ? [0, 2, 4, 6, 8, 10] : [0, 25, 50, 75, 100]} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={max === 100 || unit ? 52 : 44} tickFormatter={(v: number) => `${v}${unit}`} />
          {highlightAt && <ReferenceLine x={ts(highlightAt)} stroke="var(--axis)" strokeDasharray="3 3" />}
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as TrendPoint & { t: number };
              return (
                <TipBox>
                  <div><b>{p.value}{unit}</b> · {p.source === 'session' ? 'Coaching session' : 'Self check-in'}{p.isPrivate ? ' · Private' : ''}</div>
                  <div style={{ opacity: 0.8 }}>{fmtDateTime(p.at)}</div>
                  {p.note && <div style={{ marginTop: 4, maxWidth: 260, opacity: 0.9 }}>{p.note.length > 140 ? `${p.note.slice(0, 140)}…` : p.note}</div>}
                </TipBox>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: TrendPoint; index?: number }) => {
              const { cx, cy, payload, index } = props;
              if (cx == null || cy == null || !payload) return <g key={index} />;
              const self = payload.source === 'self';
              return <circle key={index} cx={cx} cy={cy} r={self ? 4 : 5} fill={self ? 'var(--surface)' : color} stroke={color} strokeWidth={2} />;
            }}
            activeDot={{ r: 7, strokeWidth: 2, stroke: 'var(--surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Several categories on one 0–10 axis — direct legend + consistent entity colors. */
export function MultiTrendChart({ series, height = 260 }: { series: { category: RatingCategory; points: TrendPoint[] }[]; height?: number }) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div className="empty" style={{ height }}>No ratings yet</div>;
  // Merge into rows keyed by timestamp.
  const rows = new Map<number, Record<string, number | string>>();
  for (const s of series) for (const p of s.points) {
    const t = ts(p.at);
    const row = rows.get(t) ?? { t };
    row[s.category] = p.value;
    rows.set(t, row);
  }
  const data = [...rows.values()].sort((a, b) => (a.t as number) - (b.t as number));
  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin - 259200000', 'dataMax + 259200000']} scale="time" tickFormatter={(v: number) => fmtDate(new Date(v).toISOString())} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={36} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <TipBox>
                    <div style={{ opacity: 0.8, marginBottom: 4 }}>{fmtDate(new Date(label as number).toISOString(), { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: p.color, marginRight: 6 }} />{CATEGORY_META[p.dataKey as RatingCategory].label}: <b>{p.value as number}</b></div>
                    ))}
                  </TipBox>
                );
              }}
            />
            {series.map((s) => (
              <Line key={s.category} type="monotone" dataKey={s.category} stroke={CATEGORY_META[s.category].color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: CATEGORY_META[s.category].color }} connectNulls isAnimationActive={false} activeDot={{ r: 6 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {series.map((s) => (
          <span key={s.category} className="legend-item"><span className="legend-swatch" style={{ background: CATEGORY_META[s.category].color }} />{CATEGORY_META[s.category].label}</span>
        ))}
      </div>
    </div>
  );
}

export function SourceLegend({ color }: { color: string }) {
  return (
    <div className="legend">
      <span className="legend-item"><span className="legend-swatch" style={{ background: color }} />Coaching session</span>
      <span className="legend-item" style={{ color }}><span className="legend-swatch hollow" />Self check-in</span>
    </div>
  );
}

/** Tiny inline sparkline (no axes) for tables and tiles. */
export function Sparkline({ values, color = 'var(--accent)', width = 80, height = 24, max }: { values: number[]; color?: string; width?: number; height?: number; max?: number }) {
  if (values.length < 2) return <span className="muted tiny">—</span>;
  const hi = max ?? Math.max(...values);
  const lo = max != null ? 0 : Math.min(...values);
  const range = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - lo) / range) * (height - 4)}`);
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1]!.split(',')[0]} cy={pts[pts.length - 1]!.split(',')[1]} r={2.5} fill={color} />
    </svg>
  );
}
