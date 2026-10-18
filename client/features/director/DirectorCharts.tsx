/**
 * Month-by-month trend charts for the director pages (team-wide and per coach).
 *
 * One y-axis per chart; thin marks; solid hairline grid; a legend whenever there
 * are two or more series; tooltips on hover. CARE lines use CATEGORY_META colors;
 * coaching sessions / self check-ins use the same accent / gold pairing as the
 * SourceChip so the two sources read the same everywhere in the app.
 */
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CARE_CATEGORIES, CATEGORY_META, type CareCategory } from '@shared/care';
import type { MonthPoint } from '@shared/types';
import { Card, EmptyState } from '@/components/ui';
import { IconChart } from '@/components/icons';
import { num, pct } from '@/lib/format';

const SESSION_COLOR = 'var(--accent)';
const SELF_COLOR = 'var(--gold)';
const CREATED_COLOR = 'var(--muted-2)';
const COMPLETED_COLOR = 'var(--accent)';
const DREAM_COLOR = 'var(--gold)';

const TICK = { fontSize: 11, fill: 'var(--muted)' } as const;
const AXIS_LINE = { stroke: 'var(--axis)' } as const;

interface Row {
  key: string;
  label: string;
  full: string;
  sessions: number;
  selfCheckIns: number;
  actionsCreated: number;
  actionsCompleted: number;
  dreamProgress: number | null;
  careAverage: number | null;
  contribution: number | null;
  alignment: number | null;
  relationships: number | null;
  energy: number | null;
  current: boolean;
}

function monthDate(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Rows for Recharts: short month labels, with the year added only when the series spans more than one. */
export function monthRows(months: MonthPoint[]): Row[] {
  const years = new Set(months.map((m) => m.month.slice(0, 4)));
  const now = currentMonthKey();
  return months.map((m) => {
    const d = monthDate(m.month);
    return {
      key: m.month,
      label: d.toLocaleDateString('en-US', years.size > 1 ? { month: 'short', year: '2-digit' } : { month: 'short' }).replace(' ', ' ’'),
      full: m.label,
      sessions: m.sessions,
      selfCheckIns: m.selfCheckIns,
      actionsCreated: m.actionsCreated,
      actionsCompleted: m.actionsCompleted,
      dreamProgress: m.dreamProgress,
      careAverage: m.careAverage,
      contribution: m.care.contribution ?? null,
      alignment: m.care.alignment ?? null,
      relationships: m.care.relationships ?? null,
      energy: m.care.energy ?? null,
      current: m.month === now,
    };
  });
}

function TipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="chart-tip">
      <div style={{ opacity: 0.8, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function TipRow({ color, label, value, hollow }: { color: string; label: string; value: ReactNode; hollow?: boolean }) {
  return (
    <div className="dir-tip-row">
      <span className="dir-tip-swatch" style={hollow ? { border: `2px solid ${color}` } : { background: color }} />
      <span>{label}</span>
      <b className="tnum">{value}</b>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; hollow?: boolean }[] }) {
  return (
    <div className="legend dir-legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span className={`legend-swatch${i.hollow ? ' hollow' : ''}`} style={i.hollow ? { color: i.color } : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Card wrapper: title, one-line definition, the chart, and a note when the current month is still in progress. */
export function TrendCard({ title, definition, rows, children, testId, legend }: { title: string; definition: string; rows: Row[]; children: ReactNode; testId: string; legend?: ReactNode }) {
  const inProgress = rows.some((r) => r.current);
  return (
    <Card className="dir-trend-card" data-testid={testId}>
      <div className="dir-trend-head">
        <h3>{title}</h3>
        <p className="dir-chart-def">{definition}{inProgress ? ' The current month is still in progress.' : ''}</p>
      </div>
      {children}
      {legend}
    </Card>
  );
}

function NoMonths() {
  return (
    <EmptyState icon={<IconChart />} title="No months to show yet">
      Trends appear once the program has recorded its first month of sessions.
    </EmptyState>
  );
}

const CHART_H = 200;

/* ---------- (a) Sessions & self check-ins per month ---------- */

export function SessionsChart({ rows }: { rows: Row[] }) {
  if (!rows.length) return <NoMonths />;
  return (
    <>
      <div className="dir-chart" style={{ height: CHART_H }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
            <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={{ fill: 'var(--surface-3)', opacity: 0.7 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as Row;
                return (
                  <TipBox title={`${r.full}${r.current ? ' · in progress' : ''}`}>
                    <TipRow color={SESSION_COLOR} label="Coaching sessions" value={r.sessions} />
                    <TipRow color={SELF_COLOR} label="Self check-ins" value={r.selfCheckIns} />
                  </TipBox>
                );
              }}
            />
            <Bar dataKey="sessions" name="Coaching sessions" fill={SESSION_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="selfCheckIns" name="Self check-ins" fill={SELF_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[{ color: SESSION_COLOR, label: 'Coaching sessions' }, { color: SELF_COLOR, label: 'Self check-ins' }]} />
    </>
  );
}

/* ---------- (b) Average CARE per month, four lines ---------- */

export function CareLinesChart({ rows, height = CHART_H + 20 }: { rows: Row[]; height?: number }) {
  if (!rows.length) return <NoMonths />;
  const any = rows.some((r) => CARE_CATEGORIES.some((c) => r[c] != null));
  if (!any) return <EmptyState icon={<IconChart />} title="No session ratings yet">CARE trends appear once coaching sessions record ratings.</EmptyState>;
  return (
    <>
      <div className="dir-chart" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as Row;
                return (
                  <TipBox title={`${r.full} · session ratings`}>
                    {CARE_CATEGORIES.map((c) => (
                      <TipRow key={c} color={CATEGORY_META[c].color} label={CATEGORY_META[c].label} value={r[c] == null ? '—' : num(r[c])} />
                    ))}
                    <div className="dir-tip-foot">CARE average {r.careAverage == null ? '—' : num(r.careAverage)}</div>
                  </TipBox>
                );
              }}
            />
            {CARE_CATEGORIES.map((c: CareCategory) => (
              <Line key={c} type="monotone" dataKey={c} name={CATEGORY_META[c].label} stroke={CATEGORY_META[c].color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: CATEGORY_META[c].color }} activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={CARE_CATEGORIES.map((c) => ({ color: CATEGORY_META[c].color, label: CATEGORY_META[c].label }))} />
    </>
  );
}

/* ---------- (c) Average dream progress per month ---------- */

function EndLabel({ x, y, value, index, lastIndex }: { x?: number | string; y?: number | string; value?: unknown; index?: number; lastIndex: number }) {
  if (index !== lastIndex || value == null || x == null || y == null) return null;
  return (
    <text x={Number(x)} y={Number(y) - 10} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--ink-2)" fontFamily="var(--font-body)">
      {pct(Number(value))}
    </text>
  );
}

export function DreamProgressChart({ rows }: { rows: Row[] }) {
  if (!rows.length) return <NoMonths />;
  if (!rows.some((r) => r.dreamProgress != null)) return <EmptyState icon={<IconChart />} title="No dream progress recorded yet">This line appears once coaching sessions record dream progress.</EmptyState>;
  const lastIndex = rows.reduce((last, r, i) => (r.dreamProgress != null ? i : last), -1);
  return (
    <div className="dir-chart" style={{ height: CHART_H }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 16, right: 20, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: 'var(--axis)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as Row;
              return (
                <TipBox title={`${r.full} · session entries`}>
                  <TipRow color={DREAM_COLOR} label="Average dream progress" value={r.dreamProgress == null ? '—' : pct(r.dreamProgress)} />
                </TipBox>
              );
            }}
          />
          <Line type="monotone" dataKey="dreamProgress" name="Average dream progress" stroke={DREAM_COLOR} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: DREAM_COLOR }} activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls isAnimationActive={false}>
            <LabelList dataKey="dreamProgress" content={(p) => <EndLabel {...(p as { x?: number | string; y?: number | string; value?: unknown; index?: number })} lastIndex={lastIndex} />} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- (d) Actions created vs completed per month ---------- */

export function ActionsChart({ rows }: { rows: Row[] }) {
  if (!rows.length) return <NoMonths />;
  return (
    <>
      <div className="dir-chart" style={{ height: CHART_H }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
            <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              cursor={{ fill: 'var(--surface-3)', opacity: 0.7 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as Row;
                return (
                  <TipBox title={`${r.full}${r.current ? ' · in progress' : ''}`}>
                    <TipRow color={CREATED_COLOR} label="Actions created" value={r.actionsCreated} />
                    <TipRow color={COMPLETED_COLOR} label="Actions completed" value={r.actionsCompleted} />
                  </TipBox>
                );
              }}
            />
            <Bar dataKey="actionsCreated" name="Created" fill={CREATED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="actionsCompleted" name="Completed" fill={COMPLETED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[{ color: CREATED_COLOR, label: 'Actions created' }, { color: COMPLETED_COLOR, label: 'Actions completed' }]} />
    </>
  );
}

/* ---------- All four together (coach page) ---------- */

/** `sessionsBy` names the coach on a caseload: their bars are the sessions they ran, the rest follows their dreamers. */
export function DirectorTrendGrid({ months, scope, sessionsBy, testPrefix }: { months: MonthPoint[]; scope: string; sessionsBy?: string; testPrefix: string }) {
  const rows = monthRows(months);
  const sessionsDefinition = scope === 'team'
    ? 'Completed coaching sessions and self check-ins recorded each month across the team.'
    : `Completed coaching sessions ${sessionsBy ?? 'this coach'} ran, and self check-ins by dreamers in this caseload, each month.`;
  return (
    <div className="grid grid-2 dir-trend-grid">
      <TrendCard title="Sessions & self check-ins" definition={sessionsDefinition} rows={rows} testId={`${testPrefix}-chart-sessions`}>
        <SessionsChart rows={rows} />
      </TrendCard>
      <TrendCard title="CARE ratings by month" definition="Average of the CARE ratings recorded in coaching sessions each month, per area." rows={rows} testId={`${testPrefix}-chart-care`}>
        <CareLinesChart rows={rows} />
      </TrendCard>
      <TrendCard title="Dream progress by month" definition="Average dream progress recorded in coaching sessions each month." rows={rows} testId={`${testPrefix}-chart-dreams`}>
        <DreamProgressChart rows={rows} />
      </TrendCard>
      <TrendCard title="Actions created vs completed" definition="Shared actions created and completed each month." rows={rows} testId={`${testPrefix}-chart-actions`}>
        <ActionsChart rows={rows} />
      </TrendCard>
    </div>
  );
}

export type { Row as MonthRow };
