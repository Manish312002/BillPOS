import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Access Denied screen for portal boundary violations (403 Forbidden).
 * Enforces strict portal isolation without allowing URL or state manipulation.
 */
export function AccessDeniedPage({
  title = '403 — Access Forbidden',
  message = 'You do not have the required authorization to access this portal namespace.',
  returnPath = '/',
  returnLabel = 'Return to Portal Index',
}) {
  return (
    <div
      role="alert"
      className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 text-center shadow-xl shadow-slate-950/60 space-y-5">
        <div className="mx-auto h-12 w-12 rounded-lg bg-amber-950/60 border border-amber-800/80 flex items-center justify-center text-amber-400">
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">{message}</p>
        </div>

        <div className="pt-2">
          <Link
            to={returnPath}
            className="inline-block w-full h-10 leading-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-xs transition-colors border border-slate-700"
          >
            {returnLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AccessDeniedPage;
