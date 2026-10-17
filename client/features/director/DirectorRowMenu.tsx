/**
 * A small "⋯" menu for table rows and cards. The menu itself is rendered in a
 * portal with fixed positioning so it is never clipped by a scrolling table.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconMore } from '@/components/icons';

export interface RowMenuItem { key: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; testId?: string; disabled?: boolean }

export function DirectorRowMenu({ items, label, testId }: { items: RowMenuItem[]; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = 220;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, b.right - width));
    const estimated = 12 + items.length * 40;
    const below = b.bottom + 6;
    const top = below + estimated > window.innerHeight - 8 ? Math.max(8, b.top - 6 - estimated) : below;
    setPos({ top, left });
  }, [items.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Scroll events arrive asynchronously (next frame), so a scroll that happened just before the
    // opening tap would otherwise close the menu immediately. Follow the button instead of closing.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <span className="dir-row-menu" onClick={stop} onKeyDown={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className="btn btn-ghost btn-icon dir-row-menu-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} data-testid={testId}>
        <IconMore />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className="dir-menu" role="menu" style={{ top: pos.top, left: pos.left }} onClick={stop} data-testid={testId ? `${testId}-list` : undefined}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className="menu-item" disabled={it.disabled} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect(); }} data-testid={it.testId}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}
