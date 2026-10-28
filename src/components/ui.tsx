import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'default';
type Size = 'sm' | 'md' | 'lg';

function btnClass(variant: Variant = 'default', size: Size = 'md', block?: boolean, icon?: boolean, extra?: string) {
  return ['btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', icon && 'btn--icon', extra]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: string;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, loading, icon, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={btnClass(variant, size, block, iconOnly, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Icon name="refresh" className="spin" /> : icon ? <Icon name={icon} /> : null}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  );
});

export function LinkButton({ variant, size, block, icon, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; block?: boolean; icon?: string }) {
  return (
    <Link className={btnClass(variant, size, block, false, className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

export function Card({ children, className, as: As = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li' } & Record<string, unknown>) {
  return (
    <As className={['card', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </As>
  );
}

export type Tone = 'success' | 'warn' | 'danger' | 'info' | 'accent' | 'brass' | 'neutral';
export function Badge({ tone = 'neutral', children, live, icon }: { tone?: Tone; children: ReactNode; live?: boolean; icon?: string }) {
  return (
    <span className={['badge', tone !== 'neutral' && `badge--${tone}`, live && 'badge--live'].filter(Boolean).join(' ')}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export function Banner({ tone = 'info', title, children, icon, action }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; icon?: string; action?: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon ?? (tone === 'danger' ? 'alert' : tone === 'success' ? 'check' : 'info')} />
      <div className="grow">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

// ---------- form fields ----------
interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <span id={hintId} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errId} className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextInput({ label, hint, error, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <input id={id} className="input" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <textarea id={id} className="textarea" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </Field>
  );
}

export function Select({ label, hint, error, children, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="select" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** Number input that yields `null` when empty. */
export function NumberInput({
  label,
  hint,
  error,
  value,
  onValue,
  min,
  max,
  placeholder,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  value: number | null | undefined;
  onValue: (n: number | null) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <TextInput
      label={label}
      hint={hint}
      error={error}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onValue(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span className="toggle__text">
        <span style={{ fontWeight: 700 }}>{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  name,
}: {
  legend: ReactNode;
  value: T;
  options: { value: T; label: ReactNode; icon?: string }[];
  onChange: (v: T) => void;
  name?: string;
}) {
  const auto = useId();
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="seg">
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name ?? auto} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------- avatar ----------
export function Avatar({ name, color, icon, size }: { name: string; color?: string; icon?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={['avatar', size && size !== 'md' && `avatar--${size}`].filter(Boolean).join(' ')} style={{ background: color ?? '#F2A93B' }} title={name}>
      {icon ? <Icon name={icon} size={size === 'lg' ? 30 : size === 'sm' ? 15 : 20} /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// ---------- states ----------
export function Skeleton({ height = 80, width = '100%', radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 120 : 72} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = 'sparkles', title, children, action }: { icon?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'That didn’t load' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <div className="empty" role="alert">
      <span className="empty__icon" style={{ background: 'var(--c-danger-bg)', color: 'var(--c-danger)' }}>
        <Icon name="alert" size={30} />
      </span>
      <h3>{title}</h3>
      <p className="muted">{msg}</p>
      {onRetry && (
        <Button icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ---------- dialogs ----------
/** Bottom sheet on phones, centred dialog on larger screens. Uses the native <dialog> for focus trapping + Esc. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="sheet__grip" aria-hidden="true" />
          <div className="sheet__head">
            <h2 id={titleId}>{title}</h2>
            <Button variant="ghost" iconOnly icon="x" onClick={onClose}>
              Close
            </Button>
          </div>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sticky-actions" style={{ margin: 0 }}>{footer}</div>}
        </>
      )}
    </dialog>
  );
}
