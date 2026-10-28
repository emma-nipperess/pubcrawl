import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';
import { Icon } from './Icon';
import { friendlyError } from '@/lib/errors';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Require typing this word to confirm (for irreversible actions). */
  typeToConfirm?: string;
}

interface FeedbackApi {
  toast: (text: string, kind?: ToastKind) => void;
  error: (err: unknown) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const nextId = useRef(1);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  const error = useCallback((err: unknown) => toast(err instanceof Error ? err.message : friendlyError(err), 'error'), [toast]);
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setConfirmState({ ...opts, resolve });
      }),
    [],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (confirmState && !d.open) d.showModal?.();
    if (!confirmState && d.open) d.close?.();
  }, [confirmState]);

  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };
  const blocked = Boolean(confirmState?.typeToConfirm && typed.trim().toUpperCase() !== confirmState.typeToConfirm.toUpperCase());

  return (
    <Ctx.Provider value={{ toast, error, confirm }}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} />
            <span className="grow">{t.text}</span>
          </div>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className="confirm"
        aria-labelledby="confirm-title"
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
      >
        {confirmState && (
          <div className="stack">
            <h2 id="confirm-title" style={{ fontSize: 'var(--fs-lg)' }}>
              {confirmState.title}
            </h2>
            {confirmState.body && <div className="muted">{confirmState.body}</div>}
            {confirmState.typeToConfirm && (
              <label className="field">
                <span className="field__label">Type {confirmState.typeToConfirm} to confirm</span>
                <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
              </label>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button onClick={() => close(false)}>{confirmState.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={confirmState.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)} autoFocus>
                {confirmState.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback outside FeedbackProvider');
  return v;
}
