import React from 'react';

export function PlatformOverviewPage() {
  return (
    <div className="space-y-4">
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-xl font-bold tracking-tight text-white">
          Platform Administration Overview
        </h2>
        <p className="text-sm text-slate-400">
          Structural routing verified: Superadmin namespace active under <code>/platform/*</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs font-medium text-slate-400">Namespace Status</div>
          <div className="mt-1 text-lg font-semibold text-sky-400">Active (/platform)</div>
          <div className="mt-2 text-xs text-slate-500">
            Isolated layout & independent navigation
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs font-medium text-slate-400">Security Notice</div>
          <div className="mt-1 text-lg font-semibold text-slate-200">Structural Routing</div>
          <div className="mt-2 text-xs text-slate-500">
            Backend enforces ultimate authorization
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-xs font-medium text-slate-400">Target Role</div>
          <div className="mt-1 text-lg font-semibold text-slate-200">Superadmin</div>
          <div className="mt-2 text-xs text-slate-500">
            Platform governance & tenant onboarding
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlatformOverviewPage;
