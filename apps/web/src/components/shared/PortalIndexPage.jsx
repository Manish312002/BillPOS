import React from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';

export function PortalIndexPage() {
  const { appName, version } = useSelector((state) => state.system);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center px-4">
      <div className="max-w-2xl w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono text-slate-300">
          <span>{appName} Foundation v{version}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          <span>Dual Portal Architecture</span>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Retail Operations Portal Entry
        </h1>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          Single React application with distinct portal routing and layout isolation. Choose a portal namespace to verify routing:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left pt-4">
          <Link
            to="/platform/overview"
            className="group block p-6 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-sky-500/50 hover:bg-slate-900 transition-all duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 font-mono">
                Namespace: /platform/*
              </span>
              <span className="text-slate-500 group-hover:text-sky-400 transition-colors">→</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-white group-hover:text-sky-300 transition-colors">
              Superadmin Portal
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Multi-tenant administration, system logs, and global platform configuration.
            </p>
          </Link>

          <Link
            to="/owner/overview"
            className="group block p-6 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-emerald-500/50 hover:bg-slate-900 transition-all duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
                Namespace: /owner/*
              </span>
              <span className="text-slate-500 group-hover:text-emerald-400 transition-colors">→</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-white group-hover:text-emerald-300 transition-colors">
              Store Owner Portal
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Tenant billing register, inventory catalog, and local store operations.
            </p>
          </Link>
        </div>

        <div className="pt-6 border-t border-slate-800 text-xs text-slate-500">
          Notice: Routing separation established. Backend enforces ultimate authorization.
        </div>
      </div>
    </div>
  );
}

export default PortalIndexPage;
