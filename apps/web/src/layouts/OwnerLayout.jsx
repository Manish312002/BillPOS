import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logoutUser } from '../app/store/authSlice.js';
import StatusBadge from '../components/shared/StatusBadge.jsx';

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
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800">
      {/* Store Owner Header */}
      <header className="border-b border-emerald-800 bg-emerald-950 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-20 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-md text-emerald-300 hover:text-white hover:bg-emerald-900 focus:outline-none"
            aria-label="Toggle Navigation"
          >
            <span className="text-lg">☰</span>
          </button>

          <div className="h-8 w-8 rounded bg-emerald-600 flex items-center justify-center font-bold text-white text-sm">
            BB
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold leading-none tracking-tight text-white">
                BillingBuddy
              </h1>
              <span className="hidden sm:inline-block text-xs font-mono text-emerald-600">/</span>
              <span className="hidden sm:inline-block text-xs text-emerald-200">
                {currentTitle}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono text-emerald-300">Store Operations</span>
              <span className="text-[11px] text-emerald-400 font-mono hidden sm:inline">
                • Store #101
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <StatusBadge label="Register: Ready" variant="active" />
          {user && (
            <span className="hidden md:inline-flex text-xs font-mono text-emerald-300/80">
              {user.fullName || user.phone}
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs px-2.5 py-1 rounded bg-emerald-900 text-emerald-200 hover:text-rose-300 hover:bg-emerald-800 transition-colors cursor-pointer"
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
          className={`fixed inset-y-0 left-0 top-14 z-30 w-64 border-r border-slate-200 bg-white p-4 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 shadow-xs ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Store Navigation
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
                      ? 'bg-emerald-50 text-emerald-800 font-semibold border-l-2 border-emerald-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 pt-4 border-t border-slate-200 px-2 text-xs text-slate-500">
            <div>Tenant: Active Store Context</div>
            <div className="text-[11px] text-slate-400 mt-1">Tenant boundaries enforced by API</div>
          </div>
        </aside>

        {/* Content Outlet */}
        <main className="flex-1 p-4 sm:p-6 bg-slate-50 overflow-x-auto">
          <Outlet />
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 py-2 text-xs text-slate-500 flex flex-col sm:flex-row justify-between gap-1">
        <span>BillingBuddy Store Workspace • Retail Operations</span>
        <span>
          Namespace: <code>/owner/*</code>
        </span>
      </footer>
    </div>
  );
}

export default OwnerLayout;
