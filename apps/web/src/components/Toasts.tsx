import { useRoomStore } from '../state/roomStore.js';

export function Toasts() {
  const toasts = useRoomStore((s) => s.toasts);
  const dismiss = useRoomStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.tone}`}
          onClick={() => dismiss(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
