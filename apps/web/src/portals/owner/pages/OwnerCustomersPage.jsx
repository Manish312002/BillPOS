import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';

export function OwnerCustomersPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Ledger & Accounts"
        description="Store credit tracking, customer profiles, and transaction balance history."
        badge="Ledger"
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-sm font-medium text-slate-800">Route Verification</span>
          <StatusBadge label="Namespace: /owner/customers" variant="active" />
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Structural view ready for customer khata/ledger records, credit limits, and purchase
          histories in future work packages.
        </p>
      </div>
    </div>
  );
}

export default OwnerCustomersPage;
