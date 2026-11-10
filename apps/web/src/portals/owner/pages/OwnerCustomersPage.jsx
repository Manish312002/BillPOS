import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';

export function OwnerCustomersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Ledger & Accounts"
        description="Store credit tracking, customer profiles, and transaction balance history."
        badge="Ledger"
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 shadow-xs transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-300">Route Verification</span>
          <StatusBadge label="Namespace: /owner/customers" variant="active" />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Structural view ready for customer khata/ledger records, credit limits, and purchase
          histories in future work packages.
        </p>
      </div>
    </div>
  );
}

export default OwnerCustomersPage;
