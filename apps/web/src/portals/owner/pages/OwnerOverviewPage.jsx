import React from 'react';

export function OwnerOverviewPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-slate-200 pb-3">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          Store Operations Overview
        </h2>
        <p className="text-sm text-slate-500">
          Structural routing verified: Store Owner namespace active under <code>/owner/*</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="text-xs font-medium text-slate-500">Namespace Status</div>
          <div className="mt-1 text-lg font-semibold text-emerald-600">Active (/owner)</div>
          <div className="mt-2 text-xs text-slate-400">
            Tenant layout & operational navigation
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="text-xs font-medium text-slate-500">Security Notice</div>
          <div className="mt-1 text-lg font-semibold text-slate-800">Structural Routing</div>
          <div className="mt-2 text-xs text-slate-400">
            Tenant boundaries enforced by API
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="text-xs font-medium text-slate-500">Target Role</div>
          <div className="mt-1 text-lg font-semibold text-slate-800">Store Owner / Cashier</div>
          <div className="mt-2 text-xs text-slate-400">
            Billing register, inventory, reports
          </div>
        </div>
      </div>
    </div>
  );
}

export default OwnerOverviewPage;
