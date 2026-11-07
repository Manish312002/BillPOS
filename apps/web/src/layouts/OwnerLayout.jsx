import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

export function OwnerLayout() {
  const navItems = [
    { label: 'Store Overview', path: '/owner/overview' },
    { label: 'Billing Register', path: '/owner/billing' },
    { label: 'Inventory Catalog', path: '/owner/inventory' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Store Owner Header */}
      <header className="border-b border-emerald-800 bg-emerald-950 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 rounded bg-emerald-600 flex items-center justify-center font-bold text-white text-sm">
            BB
          </div>
          <div>
            <h1 className="text-base font-semibold leading-none tracking-tight text-white">
              BillingBuddy
            </h1>
            <span className="text-xs font-mono text-emerald-300">Store Operations Portal</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <span className="inline-flex items-center rounded-md bg-emerald-900/60 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-700/50">
            Tenant Namespace (/owner/*)
          </span>
          <NavLink
            to="/"
            className="text-xs text-emerald-200 hover:text-white transition-colors"
          >
            Portal Switcher
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1">
        {/* Store Owner Navigation Sidebar */}
        <aside className="w-60 border-r border-slate-200 bg-white p-4 shadow-xs">
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Store Navigation
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Content Outlet */}
        <main className="flex-1 p-6 bg-slate-50">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-2 text-xs text-slate-500 flex justify-between">
        <span>Store Owner Workspace • Foundation Architecture</span>
        <span>Route Prefix: /owner/*</span>
      </footer>
    </div>
  );
}

export default OwnerLayout;
