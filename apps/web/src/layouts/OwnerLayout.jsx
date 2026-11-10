import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logoutUser } from '../app/store/authSlice.js';
import StatusBadge from '../components/shared/StatusBadge.jsx';
import ThemeQuickToggle from '../components/theme/ThemeQuickToggle.jsx';

export function OwnerLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);

  const handleLogout = async () => {
    await dispatch(logoutUser());
    navigate('/owner/login', { replace: true });
  };

  const navItems = [
    { label: 'Store Overview', path: '/owner/overview' },
    { label: 'Billing Register', path: '/owner/billing' },
    { label: 'POS Counter', path: '/owner/pos' },
    { label: 'Inventory Catalog', path: '/owner/inventory' },
    { label: 'Customer Ledger', path: '/owner/customers' },
    { label: 'Store Settings', path: '/owner/settings' },
  ];

  // Derive active label for breadcrumbs
  const currentNav = navItems.find((item) => location.pathname.startsWith(item.path));
  const currentTitle = currentNav ? currentNav.label : 'Overview';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 transition-colors">
      {/* Store Owner Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-2xs backdrop-blur-sm transition-colors">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none"
            aria-label="Toggle Navigation"
          >
            <span className="text-lg">☰</span>
          </button>

          <div
            className="h-8 w-8 rounded flex items-center justify-center font-bold text-white text-sm shadow-2xs"
            style={{ backgroundColor: 'var(--theme-primary)' }}
          >
            BB
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold leading-none tracking-tight text-slate-900 dark:text-white">
                BillingBuddy
              </h1>
              <span className="hidden sm:inline-block text-xs font-mono text-slate-400 dark:text-slate-600">/</span>
              <span className="hidden sm:inline-block text-xs text-slate-600 dark:text-slate-300">
                {currentTitle}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-xs font-mono font-medium"
                style={{ color: 'var(--theme-primary)' }}
              >
                Store Operations
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono hidden sm:inline">
                • Store Context Active
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Theme Quick Toggle (Light/Dark + Color Swatches) */}
          <ThemeQuickToggle />

          <StatusBadge label="Register: Ready" variant="active" />
          {user && (
            <span className="hidden md:inline-flex text-xs font-mono text-slate-500 dark:text-slate-400">
              {user.fullName || user.phone}
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 relative">
        {/* Mobile Backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Store Owner Navigation Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 top-14 z-30 w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 shadow-xs ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Store Navigation
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                style={({ isActive }) =>
                  isActive
                    ? {
                        backgroundColor: 'var(--theme-primary-light)',
                        color: 'var(--theme-primary)',
                        borderColor: 'var(--theme-primary)',
                      }
                    : {}
                }
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'font-semibold border-l-2'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800 px-2 text-xs text-slate-400 dark:text-slate-500">
            <div>Tenant: Active Store Context</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-600 mt-1">Tenant boundaries enforced by API</div>
          </div>
        </aside>

        {/* Content Outlet */}
        <main className="flex-1 p-4 sm:p-6 bg-slate-50 dark:bg-slate-900/40 overflow-x-auto transition-colors">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 sm:px-6 py-2 text-xs text-slate-400 dark:text-slate-500 flex flex-col sm:flex-row justify-between gap-1 transition-colors">
        <span>BillingBuddy Store Workspace • Retail Operations</span>
        <span>
          Namespace: <code>/owner/*</code>
        </span>
      </footer>
    </div>
  );
}

export default OwnerLayout;
