import React from 'react';
import PageHeader from '../../../components/shared/PageHeader.jsx';
import StatusBadge from '../../../components/shared/StatusBadge.jsx';
import ThemeSettingsCard from '../../../components/theme/ThemeSettingsCard.jsx';

export function PlatformSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform Configuration"
        description="Global system parameters, visual appearance themes, and multi-tenant operational policies."
        badge="Superadmin"
      />

      {/* Theme & Visual Appearance Customizer */}
      <ThemeSettingsCard />

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-300">Route Verification</span>
          <StatusBadge label="Namespace: /platform/settings" variant="info" />
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Structural view ready for global platform settings, webhook registrations, and integration
          endpoints.
        </p>
      </div>
    </div>
  );
}

export default PlatformSettingsPage;
