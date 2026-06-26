/** Système de toasts minimal (notifications éphémères). */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, Info, AlertTriangle } from 'lucide-react';

type ToastTone = 'info' | 'success' | 'warning';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const Icon =
            t.tone === 'success' ? CheckCircle2 : t.tone === 'warning' ? AlertTriangle : Info;
          return (
            <div
              key={t.id}
              className={clsx(
                'pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg',
                t.tone === 'success' && 'bg-emerald-600',
                t.tone === 'warning' && 'bg-amber-600',
                t.tone === 'info' && 'bg-slate-800',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans un <ToastProvider>.');
  return ctx;
}
