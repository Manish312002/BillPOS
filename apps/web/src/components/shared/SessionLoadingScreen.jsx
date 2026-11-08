import React from 'react';

/**
 * Neutral full-page loading screen rendered during initial session restoration.
 * Prevents any flash of protected dashboard content before authorization completes.
 */
export function SessionLoadingScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4"
    >
      <div className="flex flex-col items-center text-center space-y-4 max-w-sm">
        {/* Solid brand emblem */}
        <div className="h-10 w-10 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          BB
        </div>

        {/* Crisp spinner */}
        <div className="flex items-center gap-3">
          <svg
            className="h-5 w-5 animate-spin text-sky-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm font-medium text-slate-200">Verifying security session...</span>
        </div>

        <p className="text-xs text-slate-500">BillingBuddy Centralized Authentication Subsystem</p>
      </div>
    </div>
  );
}

export default SessionLoadingScreen;
