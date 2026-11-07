import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

export function PlatformLayout() {
  const navItems = [
    { label: 'Overview', path: '/platform/overview' },
    { label: 'Tenants & Stores', path: '/platform/tenants' },
    { label: 'Platform Logs', path: '/platform/logs' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Platform Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 rounded bg-sky-600 flex items-center justify-center font-bold text-white text-sm">
            BB
          </div>
          <div>
            <h1 className="text-base font-semibold leading-none tracking-tight text-white">
              BillingBuddy
            </h1>
            <span className="text-xs font-mono text-sky-400">Platform Superadmin</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <span className="inline-flex items-center rounded-md bg-sky-950 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-inset ring-sky-700/40">
            Platform Namespace (/platform/*)
          </span>
          <NavLink
            to="/"
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Portal Switcher
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1">
        {/* Platform Navigation Sidebar */}
        <aside className="w-60 border-r border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Platform Navigation
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-sky-300 font-semibold border-l-2 border-sky-500'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Content Outlet */}
        <main className="flex-1 p-6 bg-slate-900/20">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 px-6 py-2 text-xs text-slate-400 flex justify-between">
        <span>Superadmin Portal • Foundation Architecture</span>
        <span>Route Prefix: /platform/*</span>
      </footer>
    </div>
  );
}

export default PlatformLayout;
