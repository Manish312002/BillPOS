import React from 'react';

export function PlatformTenantsPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-xl font-bold tracking-tight text-white">Tenants & Store Directory</h2>
        <p className="text-sm text-slate-400">
          Superadmin route verification: <code>/platform/tenants</code>.
        </p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
        Placeholder view for tenant management. Business functionality will be introduced in
        subsequent work packages.
      </div>
    </div>
  );
}

export default PlatformTenantsPage;
