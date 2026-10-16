import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORY_META, type RatingCategory } from '@shared/care';
import type { EntrySource } from '@shared/types';
import { IconCheck, IconLock, IconUnlock, IconX } from './icons';

/* ---------- Button ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'default';
type Size = 'sm' | 'md' | 'lg';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: boolean;
  loading?: boolean;
}
export function Button({ variant = 'default', size = 'md', block, icon, loading, className = '', children, disabled, ...rest }: ButtonProps) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', icon && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ children, className = '', pad = true, soft, ...rest }: { children: ReactNode; className?: string; pad?: boolean | 'sm'; soft?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card', pad === 'sm' ? 'card-pad-sm' : pad ? 'card-pad' : '', soft && 'card-soft', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
export function CardHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {sub && <div className="card-sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ eyebrow, title, lead, actions }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/* ---------- Fields ---------- */
export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function TextArea({ autoGrow = true, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(480, el.scrollHeight + 2)}px`;
  }, [props.value, autoGrow]);
  return <textarea ref={ref} rows={props.rows ?? 3} {...props} />;
}

/* ---------- Rating input 0–10 ---------- */
export function RatingInput({
  value,
  onChange,
  category,
  compact,
  label,
  allowClear,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  category?: RatingCategory;
  compact?: boolean;
  label?: string;
  allowClear?: boolean;
}) {
  const meta = category ? CATEGORY_META[category] : null;
  const style = meta ? ({ '--rating-color': meta.color, '--rating-tint': meta.tint } as React.CSSProperties) : undefined;
  return (
    <div className={`rating-input${compact ? ' compact' : ''}`} role="radiogroup" aria-label={label ?? (meta ? `${meta.label} rating` : 'Rating')} style={style}>
      {Array.from({ length: 11 }, (_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          className={value != null && i < value ? 'below' : ''}
          onClick={() => onChange(allowClear && value === i ? null : i)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(10, (value ?? -1) + 1)); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, (value ?? 1) - 1)); }
          }}
        >
          {i}
        </button>
      ))}
    </div>
  );
}

/* ---------- Percent input 0–100 ---------- */
export function PercentInput({ value, onChange, color, label, disabled }: { value: number | null; onChange: (v: number) => void; color?: string; label?: string; disabled?: boolean }) {
  const id = useId();
  const v = value ?? 0;
  return (
    <div className="pct-input" style={color ? ({ '--pct-color': color } as React.CSSProperties) : undefined}>
      <input id={id} type="range" min={0} max={100} step={1} value={v} aria-label={label ?? 'Progress'} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        type="number"
        min={0}
        max={100}
        value={value ?? ''}
        placeholder="—"
        aria-label={`${label ?? 'Progress'} percent`}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === '') return;
          if (!Number.isNaN(n)) onChange(Math.max(0, Math.min(100, Math.round(n))));
        }}
      />
      <span className="pct-unit">%</span>
    </div>
  );
}

/* ---------- Privacy toggle ---------- */
export function PrivacyToggle({ value, onChange, size, labels }: { value: boolean; onChange: (v: boolean) => void; size?: 'sm'; labels?: [string, string] }) {
  const [shared, priv] = labels ?? ['Shared with coach', 'Private'];
  return (
    <button type="button" className="privacy-toggle" aria-pressed={value} onClick={() => onChange(!value)} title={value ? 'Only you can see this. Click to share with your coach.' : 'Your coach can see this. Click to make it private.'} style={size === 'sm' ? { minHeight: 26, fontSize: 12 } : undefined}>
      {value ? <IconLock /> : <IconUnlock />}
      <span>{value ? priv : shared}</span>
    </button>
  );
}

/* ---------- Chips ---------- */
export function Chip({ children, className = '', color, tint, ...rest }: { children: ReactNode; className?: string; color?: string; tint?: string } & ButtonHTMLAttributes<HTMLSpanElement>) {
  const style = { ...(color ? { '--chip-color': color } : {}), ...(tint ? { '--chip-tint': tint } : {}) } as React.CSSProperties;
  return (
    <span className={`chip ${className}`} style={style} {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>
      {children}
    </span>
  );
}
export function CategoryChip({ category, short }: { category: RatingCategory; short?: boolean }) {
  const m = CATEGORY_META[category];
  return (
    <Chip className="chip-cat" color={m.color} tint={m.tint}>
      <span className="chip-dot" />
      {short ? m.short : m.label}
    </Chip>
  );
}
export function SourceChip({ source, coachName }: { source: EntrySource; coachName?: string }) {
  return <Chip className={source === 'session' ? 'chip-session' : 'chip-self'}>{source === 'session' ? (coachName ? `Session · ${coachName}` : 'Coaching session') : 'Self check-in'}</Chip>;
}
export function PrivateChip({ compact }: { compact?: boolean }) {
  return (
    <Chip className="chip-private" title="Only you can see this">
      <IconLock />
      {!compact && 'Private'}
    </Chip>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({ initials, size, tone }: { initials: string; size?: 'sm' | 'lg'; tone?: 'gold' | 'plum' }) {
  return <span className={['avatar', size && `avatar-${size}`, tone && `avatar-${tone}`].filter(Boolean).join(' ')} aria-hidden>{initials}</span>;
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; ariaLabel?: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ---------- Loading ---------- */
export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}
export function LoadingPage({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-page">
      <Spinner /> <span>{label}</span>
    </div>
  );
}
export function Skeleton({ h = 16, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} aria-hidden />;
}

/* ---------- Stat tile ---------- */
export function Stat({ label, value, sub, delta }: { label: ReactNode; value: ReactNode; sub?: ReactNode; delta?: number | null }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value tnum">{value}</div>
      {(sub || delta != null) && (
        <div className="stat-sub row">
          {delta != null && <Delta value={delta} />}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
export function Delta({ value, digits = 1, suffix = '' }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  if (value == null) return null;
  const cls = value > 0 ? 'delta-up' : value < 0 ? 'delta-down' : 'delta-flat';
  const s = Math.abs(value).toFixed(digits).replace(/\.0$/, '');
  return <span className={`delta ${cls} tnum`}>{value > 0 ? '▲' : value < 0 ? '▼' : '•'} {value === 0 ? 'no change' : `${s}${suffix}`}</span>;
}

/* ---------- Progress bar ---------- */
export function Bar({ value, color, large, label }: { value: number | null; color?: string; large?: boolean; label?: string }) {
  return (
    <div className={`bar${large ? ' bar-lg' : ''}`} role="progressbar" aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={label} style={color ? ({ '--bar-color': color } as React.CSSProperties) : undefined}>
      <span style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

/* ---------- Checkbox (round) ---------- */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className="check" role="checkbox" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      {checked && <IconCheck />}
    </button>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-close)');
    first?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2 style={{ fontSize: 20 }}>{title}</h2>
          <Button variant="ghost" icon className="modal-close" aria-label="Close" onClick={onClose}><IconX /></Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; body?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {body && <p style={{ color: 'var(--ink-2)' }}>{body}</p>}
    </Modal>
  );
}

/* ---------- Menu (simple dropdown) ---------- */
export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOutside, active]);
}

export function Dropdown({ trigger, children, align = 'right' }: { trigger: (open: boolean) => ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div className="user-menu" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
