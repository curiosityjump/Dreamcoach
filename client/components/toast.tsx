import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconInfo, IconLock, IconX } from './icons';

type Kind = 'success' | 'error' | 'info' | 'private';
interface Toast { id: number; kind: Kind; message: string }
interface ToastApi { toast: (message: string, kind?: Kind) => void }

const Ctx = createContext<ToastApi>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const toast = useCallback((message: string, kind: Kind = 'success') => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, kind, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'success' && <IconCheck />}
            {t.kind === 'error' && <IconX />}
            {t.kind === 'info' && <IconInfo />}
            {t.kind === 'private' && <IconLock />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
