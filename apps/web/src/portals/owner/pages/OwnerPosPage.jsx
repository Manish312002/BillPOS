import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';

export function OwnerPosPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="POS Counter Register"
        description="Point of sale barcode scanning, checkout calculation, and receipt generation counter."
        badge="Register"
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 shadow-xs transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-300">Route Verification</span>
          <StatusBadge label="Namespace: /owner/pos" variant="active" />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Structural view ready for POS checkout register, fast-key billing, and offline receipt
          dispatch in future work packages.
        </p>
      </div>
    </div>
  );
}

export default OwnerPosPage;
