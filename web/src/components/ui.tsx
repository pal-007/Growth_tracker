import { AlertTriangle, Check, Minus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Status } from '../lib/api';

export const AVATAR_EMOJI: Record<string, string> = { rocket: '🚀', star: '⭐', planet: '🪐', comet: '☄️', galaxy: '🌌', crown: '👑' };
export const MOODS = [
  { v: 1, emoji: '😞', label: 'Rough' },
  { v: 2, emoji: '😕', label: 'Low' },
  { v: 3, emoji: '😐', label: 'Okay' },
  { v: 4, emoji: '🙂', label: 'Good' },
  { v: 5, emoji: '😄', label: 'Great' },
];
export const CATEGORY_ICON: Record<string, string> = { Study: '📚', Coding: '💻', Fitness: '🏃', Health: '💚', Personal: '🌱', Projects: '🛠️', Custom: '✨' };
export const catIcon = (c: string) => CATEGORY_ICON[c] ?? '🔹';

export function useCountUp(target: number, ms = 800) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(a + (target - a) * e));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Ring({ percent, size = 180, stroke = 14, label, sub }: { percent: number | null; size?: number; stroke?: number; label?: ReactNode; sub?: ReactNode }) {
  const p = percent ?? 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = useCountUp(p);
  const id = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={percent === null ? 'No data' : `${p} percent`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--a1)" />
            <stop offset="100%" stopColor="var(--a2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--faint)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * p) / 100}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)', filter: 'drop-shadow(0 0 8px var(--a1))' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="display text-4xl font-bold">{percent === null ? '–' : `${shown}%`}</div>
        {label && <div className="text-xs muted mt-0.5">{label}</div>}
        {sub}
      </div>
    </div>
  );
}

export function ProgressBar({ value, className = '', label }: { value: number | null; className?: string; label?: string }) {
  return (
    <div className={`progress-track ${className}`} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-bar" style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

export function Checkbox({ status, onToggle, label, disabled }: { status: Status; onToggle: (e: React.MouseEvent) => void; label: string; disabled?: boolean }) {
  const done = status === 'completed';
  return (
    <button
      type="button" role="checkbox" aria-checked={done} aria-label={`${done ? 'Undo' : 'Complete'} ${label}`} disabled={disabled}
      className="check" data-state={status === 'skipped' ? 'skipped' : status === 'in_progress' ? 'progress' : ''}
      onClick={onToggle}
    >
      {done ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3.2L13 4.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : status === 'skipped' ? <Minus size={14} aria-hidden /> : null}
    </button>
  );
}

export function Modal({ open, title, onClose, children, wide, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`glass page-enter relative w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'} max-h-[92vh] flex flex-col !rounded-b-none sm:!rounded-b-[20px]`} style={{ background: 'var(--card-solid)' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--card-border)' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onCancel, onConfirm, extra }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void; extra?: ReactNode;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>Cancel</button>
      {extra}
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </>}>
      <div className="flex gap-3"><AlertTriangle className="shrink-0" style={{ color: danger ? 'var(--bad)' : 'var(--warn)' }} /><div className="muted text-sm">{body}</div></div>
    </Modal>
  );
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs muted mt-1 block">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div><div className="font-medium text-sm">{label}</div>{hint && <div className="text-xs muted">{hint}</div>}</div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className="relative w-12 h-7 rounded-full shrink-0 border transition-colors" style={{ background: checked ? 'linear-gradient(135deg,var(--a1),var(--a2))' : 'var(--faint)', borderColor: 'var(--card-border)' }}>
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow" style={{ transform: checked ? 'translateX(20px)' : 'none' }} />
      </button>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div><h1 className="display text-3xl font-bold">{title}</h1>{sub && <p className="muted mt-1">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ emoji = '🌱', title, body, action }: { emoji?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="glass p-10 text-center">
      <div className="text-5xl mb-3 float" aria-hidden>{emoji}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="muted mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass p-6 flex items-center gap-4" role="alert">
      <AlertTriangle style={{ color: 'var(--bad)' }} />
      <div className="flex-1"><div className="font-semibold">Something went wrong</div><div className="muted text-sm">{message}</div></div>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PriorityChip({ p }: { p: string }) {
  return <span className={`chip chip-${p}`}>{p}</span>;
}

export function StatCard({ icon, label, value, sub, children }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="glass glass-hover p-4">
      <div className="flex items-center gap-2 muted text-xs font-semibold uppercase tracking-wide">{icon}{label}</div>
      <div className="display text-3xl font-bold mt-2">{value}</div>
      {sub && <div className="text-xs muted mt-1">{sub}</div>}
      {children}
    </div>
  );
}

export const Tick = () => <Check size={14} />;
