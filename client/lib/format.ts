const DAY = 86400000;

export function parseIso(s: string): Date {
  return new Date(s);
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? opts : { ...opts, year: 'numeric' });
}

export function fmtDateLong(iso: string | null | undefined): string {
  return fmtDate(iso, { weekday: 'short', month: 'long', day: 'numeric' });
}

export function fmtMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', ' ’');
}

export function fmtMonthLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const at = new Date(iso);
  const diff = Date.now() - at.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  // Days are calendar days, as in dayHeading: on Sunday, Friday evening was "2 days ago", not "yesterday".
  const days = Math.round((startOfDay(new Date()) - startOfDay(at)) / DAY);
  if (days < 1) return ago(Math.floor(diff / 3600000), 'hour');
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return ago(Math.floor(days / 7), 'week');
  if (days < 365) return ago(Math.floor(days / 30), 'month');
  return fmtDate(iso);
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - DAY).toISOString());
  const k = dayKey(iso);
  if (k === today) return 'Today';
  if (k === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function pct(n: number | null | undefined, digits = 0): string {
  return n == null ? '—' : `${n.toFixed(digits)}%`;
}

export function num(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits).replace(/\.0$/, '');
}

export function signed(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  const s = Math.abs(n).toFixed(digits).replace(/\.0$/, '');
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '±0';
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(v: string): string {
  return new Date(v).toISOString();
}
