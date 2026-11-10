import React from 'react';
import { Link } from 'react-router-dom';

export function PlatformOverviewPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 dark:border-slate-800 pb-4 transition-colors">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors">
          Platform Administration Overview
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 transition-colors">
          Structural routing verified: Superadmin namespace active under <code>/platform/*</code>.
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
            Active (/platform)
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Isolated layout & independent navigation
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors relative overflow-hidden">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Security Notice</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Structural Routing</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Backend enforces ultimate authorization</div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors relative overflow-hidden">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Target Role</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Superadmin</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Platform governance & tenant onboarding</div>
        </div>
      </div>

      {/* Quick Management Section */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-xs transition-colors space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Quick Management</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Essential navigation shortcuts for Platform Superadmins</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/platform/tenants"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white shadow-2xs transition-opacity hover:opacity-95"
            style={{ backgroundColor: 'var(--theme-primary)' }}
          >
            <span>🏢</span> Manage Tenants & Stores
          </Link>
          <Link
            to="/platform/settings"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span>🎨</span> Customize Theme & Appearance
          </Link>
          <Link
            to="/platform/audit-logs"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <span>📋</span> View Audit Trail
          </Link>
        </div>
      </div>
    </div>
  );
}

export default PlatformOverviewPage;
