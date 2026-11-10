import React from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-center items-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl font-black text-rose-500 font-mono">404</div>
        <h1 className="text-xl font-bold text-white tracking-tight">Page Not Found</h1>
        <p className="text-sm text-slate-400">
          The requested route does not exist within the Store Owner namespaces.
        </p>

        <div className="pt-4 flex justify-center gap-3">
          {/* <Link
            to="/"
            className="px-4 py-2 rounded-md bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors"
          >
            Portal Entry
          </Link> */}
          <Link
            to="/owner/overview"
            className="px-4 py-2 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors"
          >
            Store Owner
          </Link>
          {/* <Link
            to="/platform/overview"
            className="px-4 py-2 rounded-md bg-sky-600 text-white text-xs font-semibold hover:bg-sky-500 transition-colors"
          >
            Superadmin
          </Link> */}
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
