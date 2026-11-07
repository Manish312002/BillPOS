import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import StatusBadge from '../components/shared/StatusBadge.jsx';

export function PlatformLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    { label: 'Overview', path: '/platform/overview' },
    { label: 'Tenants & Stores', path: '/platform/tenants' },
    { label: 'Subscriptions', path: '/platform/subscriptions' },
    { label: 'Audit Logs', path: '/platform/audit-logs' },
    { label: 'Platform Settings', path: '/platform/settings' },
  ];

  // Derive active label for breadcrumbs
  const currentNav = navItems.find((item) => location.pathname.startsWith(item.path));
  const currentTitle = currentNav ? currentNav.label : 'Overview';

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Platform Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20 backdrop-blur-sm">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 focus:outline-none"
            aria-label="Toggle Navigation"
          >
            <span className="text-lg">☰</span>
          </button>

          <div className="h-8 w-8 rounded bg-sky-600 flex items-center justify-center font-bold text-white text-sm">
            BB
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold leading-none tracking-tight text-white">
                BillingBuddy
              </h1>
              <span className="hidden sm:inline-block text-xs font-mono text-slate-500">/</span>
              <span className="hidden sm:inline-block text-xs text-slate-400">{currentTitle}</span>
            </div>
            <span className="text-xs font-mono text-sky-400">Platform Superadmin</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <StatusBadge label="Platform Active" variant="info" />
          <span className="hidden md:inline-flex text-xs font-mono text-slate-500">
            Route: {location.pathname}
          </span>
          <NavLink
            to="/"
            className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
          >
            Switch Portal
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 relative">
        {/* Mobile Backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Platform Navigation Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 top-14 z-30 w-64 border-r border-slate-800 bg-slate-900/95 p-4 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Platform Governance
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
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

          <div className="mt-8 pt-4 border-t border-slate-800 px-2 text-xs text-slate-500">
            <div>Scope: Platform Superadmin</div>
            <div className="text-[11px] text-slate-600 mt-1">Multi-tenant management layer</div>
          </div>
        </aside>

        {/* Content Outlet */}
        <main className="flex-1 p-4 sm:p-6 bg-slate-900/20 overflow-x-auto">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 px-4 sm:px-6 py-2 text-xs text-slate-400 flex flex-col sm:flex-row justify-between gap-1">
        <span>BillingBuddy Platform Superadmin • Foundation Shell</span>
        <span>
          Namespace: <code>/platform/*</code>
        </span>
      </footer>
    </div>
  );
}

export default PlatformLayout;
