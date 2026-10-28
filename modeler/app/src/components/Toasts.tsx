import { useAppState, useController } from '../state/context';

export function Toasts() {
  const controller = useController();
  const state = useAppState();
  return (
    <div className="toasts" aria-live="polite" data-testid="toasts">
      {state.toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <div className="toast-message">{toast.message}</div>
          {toast.detail && <pre className="toast-detail">{toast.detail}</pre>}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => controller.dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
