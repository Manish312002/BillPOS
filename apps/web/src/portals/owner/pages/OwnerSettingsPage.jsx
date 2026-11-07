import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';

export function OwnerSettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Store Profile & Hardware Settings"
        description="Thermal printer configuration, invoice tax numbering, and store operational parameters."
        badge="Settings"
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-sm font-medium text-slate-800">Route Verification</span>
          <StatusBadge label="Namespace: /owner/settings" variant="active" />
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Structural view ready for store GSTIN, thermal printer ESC/POS configuration, and invoice layout customizer in future work packages.
        </p>
      </div>
    </div>
  );
}

export default OwnerSettingsPage;
