import React from 'react';

const VARIANT_STYLES = {
  active: 'bg-emerald-950/80 text-emerald-300 ring-emerald-700/50',
  pending: 'bg-amber-950/80 text-amber-300 ring-amber-700/50',
  inactive: 'bg-slate-800 text-slate-300 ring-slate-700/50',
  warning: 'bg-rose-950/80 text-rose-300 ring-rose-700/50',
  info: 'bg-sky-950/80 text-sky-300 ring-sky-700/50',
};

export function StatusBadge({ label, variant = 'info', dot = true }) {
  const variantClass = VARIANT_STYLES[variant] || VARIANT_STYLES.info;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${variantClass}`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            variant === 'active'
              ? 'bg-emerald-400'
              : variant === 'pending'
              ? 'bg-amber-400'
              : variant === 'warning'
              ? 'bg-rose-400'
              : variant === 'inactive'
              ? 'bg-slate-400'
              : 'bg-sky-400'
          }`}
        />
      )}
      {label}
    </span>
  );
}

export default StatusBadge;
