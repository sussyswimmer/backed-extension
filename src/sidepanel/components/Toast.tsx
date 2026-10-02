import { useEffect } from 'react';
import { IconX } from '../../shared/ui/Icons';

export interface ToastMessage {
  id: number;
  message: string;
}

export function Toast({ toast, onClose, raised }: { toast: ToastMessage | null; onClose: () => void; raised: boolean }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, Math.min(9000, 3500 + toast.message.length * 35));
    return () => clearTimeout(t);
  }, [toast, onClose]);

  return (
    <div
      aria-live="polite"
      role="status"
      className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 ${raised ? 'bottom-16' : 'bottom-4'}`}
    >
      {toast ? (
        <div
          key={toast.id}
          className="bk-enter pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-lg bg-ink px-3 py-2 text-[12.5px] leading-snug text-paper shadow-lg"
        >
          <p className="min-w-0 flex-1">{toast.message}</p>
          <button type="button" onClick={onClose} aria-label="Close message" className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100">
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
