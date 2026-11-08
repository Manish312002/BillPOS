import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  acknowledgeRecoveryCodes,
  regenerateRecoveryCodes,
  logoutUser,
} from '../../../app/store/authSlice.js';

function ShieldAlertIcon({ className = 'h-5 w-5' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function RefreshIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

function SpinnerIcon({ className = 'h-4 w-4 animate-spin' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default function RecoveryCodesPage({ initialCodes = [] }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { user, error: reduxError } = useSelector((state) => state.auth);

  const [codes, setCodes] = useState(
    initialCodes.length > 0 ? initialCodes : location.state?.recoveryCodes || []
  );
  const [hasConfirmedStorage, setHasConfirmedStorage] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [localError, setLocalError] = useState(null);

  const activeError = localError || reduxError;

  const handleCopyCodes = () => {
    if (codes.length > 0) {
      navigator.clipboard.writeText(codes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }
  };

  const handleRegenerate = async () => {
    setLocalError(null);
    setIsRegenerating(true);
    try {
      const resultAction = await dispatch(regenerateRecoveryCodes());
      if (regenerateRecoveryCodes.fulfilled.match(resultAction)) {
        setCodes(resultAction.payload?.recoveryCodes || []);
        setHasConfirmedStorage(false);
      } else {
        setLocalError(
          resultAction.payload?.message || 'Failed to regenerate recovery codes. Please try again.'
        );
      }
    } catch {
      setLocalError('Network connection error while regenerating recovery codes.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleAcknowledge = async (e) => {
    e.preventDefault();
    if (!hasConfirmedStorage || isSubmitting) return;

    setLocalError(null);
    setIsSubmitting(true);
    try {
      const resultAction = await dispatch(acknowledgeRecoveryCodes());
      if (acknowledgeRecoveryCodes.fulfilled.match(resultAction)) {
        if (user?.mustChangePassword) {
          navigate('/platform/change-password', { replace: true });
        } else {
          navigate('/platform/overview', { replace: true });
        }
      } else {
        setLocalError(
          resultAction.payload?.message ||
            'Failed to confirm recovery code acknowledgment on the server.'
        );
      }
    } catch {
      setLocalError('Network connection error while acknowledging recovery codes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await dispatch(logoutUser());
    navigate('/platform/login', { replace: true });
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-lg">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-xl shadow-slate-950/50">
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="h-11 w-11 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-base shadow-sm mb-3">
              BB
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/60 border border-amber-800/80 text-[11px] font-mono font-medium text-amber-300 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Action Required — Recovery Codes
            </div>

            <h1 className="text-xl font-bold tracking-tight text-white">
              Emergency Recovery Codes
            </h1>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              Save these single-use recovery codes in your password manager before accessing the
              Platform Superadmin portal.
            </p>
          </div>

          {/* Active Error Alert */}
          {activeError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200 flex items-start gap-2"
            >
              <ShieldAlertIcon className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{activeError}</span>
            </div>
          )}

          {/* Display Codes or Regeneration Prompt */}
          <div className="mt-6 space-y-4 text-left">
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 p-3 text-xs text-amber-200 leading-relaxed">
              ⚠️ Each recovery code can only be used once. If you lose your authenticator app, these
              codes are the only way to regain platform access.
            </div>

            {codes.length > 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Your 8 Emergency Codes
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCodes}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                  >
                    {copiedCodes ? '✓ Copied All' : 'Copy All Codes'}
                  </button>
                </div>

                <div
                  data-testid="recovery-codes-grid"
                  className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs text-slate-200"
                >
                  {codes.map((code, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900 px-2 py-1.5 rounded border border-slate-800 text-center select-all font-semibold tracking-wider"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-center space-y-3">
                <p className="text-xs text-slate-300">
                  Your recovery codes are not currently displayed because the page was reloaded.
                </p>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isRegenerating ? (
                    <>
                      <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                      <span>Regenerating...</span>
                    </>
                  ) : (
                    <>
                      <RefreshIcon className="h-3.5 w-3.5 text-sky-400" />
                      <span>Generate New Recovery Codes</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {codes.length > 0 && (
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className="text-slate-500">Need a fresh set of codes?</span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isRegenerating || isSubmitting}
                  className="text-slate-400 hover:text-slate-200 underline cursor-pointer disabled:opacity-50 text-xs"
                >
                  {isRegenerating ? 'Generating...' : 'Regenerate codes'}
                </button>
              </div>
            )}

            {/* Acknowledgment Form */}
            <form onSubmit={handleAcknowledge} className="pt-2 space-y-4">
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:bg-slate-950 transition-colors">
                <input
                  type="checkbox"
                  id="confirm-saved-codes"
                  checked={hasConfirmedStorage}
                  onChange={(e) => setHasConfirmedStorage(e.target.checked)}
                  disabled={codes.length === 0 || isSubmitting}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-sky-500 focus:ring-offset-slate-950 cursor-pointer"
                />
                <span className="text-xs text-slate-300 select-none leading-relaxed">
                  I confirm that I have copied and securely stored all 8 emergency recovery codes. I
                  understand they will not be shown again.
                </span>
              </label>

              <button
                type="submit"
                disabled={!hasConfirmedStorage || codes.length === 0 || isSubmitting}
                className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                    <span>Confirming with Server...</span>
                  </>
                ) : (
                  <span>Acknowledge & Continue →</span>
                )}
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  Sign out and return to login
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
