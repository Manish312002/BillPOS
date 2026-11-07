import React from 'react';

export function PageHeader({ title, description, badge, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 mb-4 border-b border-inherit">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold tracking-tight text-inherit">{title}</h2>
          {badge && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset">
              {badge}
            </span>
          )}
        </div>
        {description && <p className="text-sm opacity-70 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="mt-3 sm:mt-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
