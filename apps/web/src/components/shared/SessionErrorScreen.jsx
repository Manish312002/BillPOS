import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { restoreSession } from '../../app/store/authSlice.js';

/**
 * Screen displayed when session validation fails due to a network or backend server outage.
 * Distinguishes server outage from unauthenticated state. Provides retry functionality.
 */
export function SessionErrorScreen() {
  const dispatch = useDispatch();
  const { error } = useSelector((state) => state.auth);

  const handleRetry = () => {
    dispatch(restoreSession());
  };

  return (
    <div
      role="alert"
      className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4"
    >
      <div className="w-full max-w-md rounded-xl border border-rose-900/60 bg-slate-900 p-6 sm:p-8 text-center shadow-xl shadow-slate-950/60 space-y-5">
        <div className="mx-auto h-12 w-12 rounded-lg bg-rose-950/80 border border-rose-800/80 flex items-center justify-center text-rose-400">
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Authentication Service Unavailable
          </h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            {error ||
              'Unable to establish a secure connection with the BillingBuddy authentication server. Please check your network connection or server status.'}
          </p>
        </div>

        <div className="pt-2 space-y-2">
          <button
            type="button"
            onClick={handleRetry}
            className="w-full h-10 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-xs transition-colors shadow-sm cursor-pointer"
          >
            Retry Connection
          </button>

          <Link
            to="/"
            className="block text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors"
          >
            Return to Portal Index
          </Link>
        </div>
      </div>
    </div>
  );
}

export default SessionErrorScreen;
