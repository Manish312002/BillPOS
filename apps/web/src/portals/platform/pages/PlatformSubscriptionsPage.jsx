import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';

export function PlatformSubscriptionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription Tier Management"
        description="Configure SaaS pricing models, billing cycles, and feature flags across tenant accounts."
        badge="Superadmin"
      />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 shadow-xs transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-300">Route Verification</span>
          <StatusBadge label="Namespace: /platform/subscriptions" variant="info" />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Structural view ready for subscription tiering and plan enforcement logic in future work
          packages.
        </p>
      </div>
    </div>
  );
}

export default PlatformSubscriptionsPage;
