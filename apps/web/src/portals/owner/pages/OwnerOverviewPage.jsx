import React from 'react';
import { Link } from 'react-router-dom';

export function OwnerOverviewPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 transition-colors">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors">
          Store Operations Overview
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 transition-colors">
          Structural routing verified: Store Owner namespace active under <code>/owner/*</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors relative overflow-hidden">
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{ backgroundColor: 'var(--theme-primary)' }}
          />
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Namespace Status</div>
          <div
            className="mt-1 text-lg font-semibold"
            style={{ color: 'var(--theme-primary)' }}
          >
            Active (/owner)
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Tenant layout & operational navigation</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors relative overflow-hidden">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Security Notice</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Structural Routing</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Tenant boundaries enforced by API</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors relative overflow-hidden">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Target Role</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Store Owner / Cashier</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Billing register, inventory, reports</div>
        </div>
      </div>

      {/* Quick Access Card */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Store Counter Shortcuts</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Fast paths to daily retail store operations</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/owner/pos"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white shadow-2xs transition-opacity hover:opacity-95"
            style={{ backgroundColor: 'var(--theme-primary)' }}
          >
            <span>🛒</span> Open POS Register
          </Link>
          <Link
            to="/owner/billing"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span>🧾</span> Billing Records
          </Link>
          <Link
            to="/owner/settings"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span>⚙️</span> Store Settings & Appearance
          </Link>
        </div>
      </div>
    </div>
  );
}

export default OwnerOverviewPage;
