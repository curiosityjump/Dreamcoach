/**
 * The CARE Wheel of Life. Four quadrants (Contribution, Alignment, Relationships,
 * Energy), each filled to its 0–10 rating. Optionally interactive: click/drag inside
 * a quadrant sets its rating (on touch: tap, or drag sideways, so swiping up or down
 * still scrolls the page), and each quadrant is a keyboard slider. An optional
 * `compare` set draws a hollow outline so two points in time can be compared at a glance.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CARE_CATEGORIES, CATEGORY_META, type CareCategory } from '@shared/care';
import { textShade } from '@/lib/color';

export type WheelValues = Partial<Record<CareCategory, number | null | undefined>>;

const ORDER: CareCategory[] = ['contribution', 'alignment', 'relationships', 'energy'];
// Quadrant angular ranges (SVG coords; 0° at 12 o'clock, clockwise): C top-right, A bottom-right, R bottom-left, E top-left.
const START: Record<CareCategory, number> = { contribution: 0, alignment: 90, relationships: 180, energy: 270 };
// How far a touch may wander and still count as a tap.
const TAP_SLOP = 10;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function wedge(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y} Z`;
}
function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
}

export function WheelOfLife({
  values,
  compare,
  size = 320,
  onChange,
  showLabels = true,
  showAreas = false,
  compareLabel,
  valueLabel,
}: {
  values: WheelValues;
  compare?: WheelValues | null;
  size?: number;
  onChange?: (category: CareCategory, value: number) => void;
  showLabels?: boolean;
  showAreas?: boolean;
  compareLabel?: string;
  valueLabel?: string;
}) {
  const pad = showLabels ? 58 : 10;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - pad;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<CareCategory | null>(null);
  // The press in progress. A mouse or pen rates as it drags. A touch starts as a tap and becomes a drag only
  // once it moves sideways; an up-or-down swipe is left to the browser (touch-action: pan-y), which scrolls
  // the page and cancels the press.
  const press = useRef<{ mode: 'drag' | 'tap'; x: number; y: number } | null>(null);
  const interactive = !!onChange;

  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const svg = ref.current!;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size - cx;
    const y = ((e.clientY - rect.top) / rect.height) * size - cy;
    const dist = Math.sqrt(x * x + y * y);
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    const cat = ORDER.find((c) => deg >= START[c] && deg < START[c] + 90) ?? 'energy';
    const value = Math.max(0, Math.min(10, Math.round((dist / R) * 10)));
    return { cat, value, dist };
  };

  const handle = (e: PointerEvent<SVGSVGElement>, commit: boolean) => {
    if (!interactive) return;
    const { cat, value, dist } = fromPointer(e);
    if (dist > R * 1.15) { setHover(null); return; }
    setHover(cat);
    if (commit) onChange!(cat, value);
  };

  const onKey = (e: KeyboardEvent<SVGPathElement>, c: CareCategory) => {
    const v = values[c];
    const next = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? Math.min(10, (v ?? 0) + 1)
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? Math.max(0, (v ?? 0) - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? 10 : null;
    if (next == null) return;
    e.preventDefault();
    if (next !== v) onChange!(c, next);
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      style={{ maxWidth: size, display: 'block', margin: '0 auto', overflow: 'visible', touchAction: interactive ? 'pan-y pinch-zoom' : undefined, cursor: interactive ? 'crosshair' : undefined, userSelect: 'none' }}
      role={interactive ? 'group' : 'img'}
      aria-label={`CARE wheel: ${ORDER.map((c) => `${CATEGORY_META[c].label} ${values[c] ?? '—'}`).join(', ')}`}
      onPointerDown={(e) => {
        if (!interactive) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const touch = e.pointerType === 'touch';
        press.current = { mode: touch ? 'tap' : 'drag', x: e.clientX, y: e.clientY };
        handle(e, !touch);
      }}
      onPointerMove={(e) => {
        if (!interactive) return;
        const p = press.current;
        const dx = p ? Math.abs(e.clientX - p.x) : 0;
        if (p?.mode === 'tap' && dx > TAP_SLOP && dx > Math.abs(e.clientY - p.y)) p.mode = 'drag';
        handle(e, p?.mode === 'drag');
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (p?.mode === 'tap' && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= TAP_SLOP) handle(e, true);
      }}
      onPointerCancel={() => { press.current = null; setHover(null); }}
      onPointerLeave={() => { setHover(null); press.current = null; }}
    >
      {/* rings */}
      {[2, 4, 6, 8, 10].map((n) => (
        <circle key={n} cx={cx} cy={cy} r={(R * n) / 10} fill={n === 10 ? 'var(--surface-2)' : 'none'} stroke="var(--grid)" strokeWidth={1} />
      ))}
      {/* quadrant tints */}
      {ORDER.map((c) => (
        <path key={`tint-${c}`} d={wedge(cx, cy, R, START[c] + 1, START[c] + 89)} fill={CATEGORY_META[c].tint} opacity={hover === c ? 0.9 : 0.55} />
      ))}
      {[2, 4, 6, 8].map((n) => (
        <circle key={`ring-${n}`} cx={cx} cy={cy} r={(R * n) / 10} fill="none" stroke="var(--grid)" strokeWidth={1} />
      ))}
      {/* filled wedges */}
      {ORDER.map((c) => {
        const v = values[c];
        if (v == null) return null;
        const r = (R * v) / 10;
        return (
          <path key={`fill-${c}`} d={wedge(cx, cy, Math.max(r, 2), START[c] + 2, START[c] + 88)} fill={CATEGORY_META[c].color} opacity={0.82} style={{ transition: 'd 0.25s ease' }} />
        );
      })}
      {/* compare outline */}
      {compare &&
        ORDER.map((c) => {
          const v = compare[c];
          if (v == null) return null;
          const r = (R * v) / 10;
          return <path key={`cmp-${c}`} d={arc(cx, cy, Math.max(r, 2), START[c] + 2, START[c] + 88)} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />;
        })}
      {/* axes */}
      <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--surface)" strokeWidth={3} />
      <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--surface)" strokeWidth={3} />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--axis)" strokeWidth={1.25} />
      {/* value labels inside */}
      {ORDER.map((c) => {
        const v = values[c];
        const p = polar(cx, cy, R * 0.62, START[c] + 45);
        return (
          <g key={`val-${c}`} pointerEvents="none">
            <circle cx={p.x} cy={p.y} r={16} fill="var(--surface)" stroke={CATEGORY_META[c].color} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--ink)" fontFamily="var(--font-body)">{v ?? '–'}</text>
          </g>
        );
      })}
      {/* labels outside */}
      {showLabels &&
        ORDER.map((c) => {
          const p = polar(cx, cy, R + 30, START[c] + 45);
          const anchor = p.x < cx - 5 ? 'end' : p.x > cx + 5 ? 'start' : 'middle';
          const sx = anchor === 'end' ? p.x + 6 : anchor === 'start' ? p.x - 6 : p.x;
          return (
            <g key={`lbl-${c}`} pointerEvents="none">
              <text x={sx} y={p.y - (showAreas ? 8 : 0)} textAnchor={anchor} fontSize={13} fontWeight={600} fill={textShade(CATEGORY_META[c].color)} fontFamily="var(--font-body)">{CATEGORY_META[c].label}</text>
              {showAreas && CATEGORY_META[c].areas.map((a, i) => (
                <text key={a} x={sx} y={p.y + 7 + i * 13} textAnchor={anchor} fontSize={10.5} fill="var(--muted)" fontFamily="var(--font-body)">{a}</text>
              ))}
            </g>
          );
        })}
      {/* keyboard: one slider per quadrant (arrow keys, Home, End); the ring shows which has focus */}
      {interactive &&
        ORDER.map((c) => (
          <path
            key={`key-${c}`}
            className="wheel-key"
            d={wedge(cx, cy, R, START[c] + 1, START[c] + 89)}
            pointerEvents="none"
            tabIndex={0}
            role="slider"
            aria-label={CATEGORY_META[c].label}
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={values[c] ?? undefined}
            aria-valuetext={values[c] == null ? 'Not rated' : `${values[c]} out of 10`}
            onKeyDown={(e) => onKey(e, c)}
          />
        ))}
      {(valueLabel || (compare && compareLabel)) && (
        <g fontSize={11} fontFamily="var(--font-body)" fill="var(--muted)">
          {valueLabel && <text x={8} y={size - 8}>{valueLabel}</text>}
          {compare && compareLabel && <text x={size - 8} y={size - 8} textAnchor="end">- - {compareLabel}</text>}
        </g>
      )}
    </svg>
  );
}

export const WHEEL_ORDER = ORDER;
export const CARE_LIST = CARE_CATEGORIES;
