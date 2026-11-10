import React from 'react';

export function PageHeader({ title, description, badge, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 mb-4 border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors">{title}</h2>
          {badge && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed transition-colors">{description}</p>}
      </div>
      {actions && <div className="mt-3 sm:mt-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
