import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { loginOwner, AUTH_STATES } from '../../../app/store/authSlice';

export function OwnerLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const dispatch = useDispatch();
  const { authState } = useSelector((state) => state.auth);

  // Initialize from search params or router location state if available
  const initialIdentifier =
    searchParams.get('identifier') ||
    searchParams.get('email') ||
    searchParams.get('phone') ||
    location.state?.identifier ||
    '';

  const initialSlug =
    searchParams.get('slug') ||
    searchParams.get('store') ||
    location.state?.tenantSlug ||
    '';

  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState(initialSlug);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // If already authenticated as owner, immediately redirect to intended destination
  useEffect(() => {
    if (authState === AUTH_STATES.AUTHENTICATED_OWNER) {
      const from = location.state?.from;
      const destination =
        typeof from === 'string' && from.startsWith('/owner') ? from : '/owner/overview';
      navigate(destination, { replace: true });
    }
  }, [authState, location.state, navigate]);

  const handleIdentifierChange = (e) => {
    setIdentifier(e.target.value);
    if (errorMessage) setErrorMessage(null);
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (errorMessage) setErrorMessage(null);
  };

  const handleTenantSlugChange = (e) => {
    setTenantSlug(e.target.value);
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    // Normalize store slug if provided: trimmed, lowercase, stripped slashes
    const cleanSlug = tenantSlug.trim()
      ? tenantSlug.trim().toLowerCase().replace(/^\/+|\/+$/g, '')
      : undefined;

    try {
      await dispatch(
        loginOwner({
          identifier: cleanIdentifier,
          password,
          tenantSlug: cleanSlug,
        })
      ).unwrap();

      const from = location.state?.from;
      const destination =
        typeof from === 'string' && from.startsWith('/owner') ? from : '/owner/overview';
      navigate(destination, { replace: true });
    } catch (err) {
      setErrorMessage(
        err.message || 'Invalid credentials or you do not have store owner access.'
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center px-4 py-8 transition-colors duration-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-slate-950/60 space-y-6">
        {/* Brand emblem */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div
            className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm transition-colors"
            style={{
              backgroundColor: 'var(--theme-primary, #059669)',
            }}
          >
            BB
          </div>

          {/* Portal badge */}
          <div
            className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border text-[11px] font-mono font-semibold"
            style={{
              backgroundColor: 'var(--theme-bg-subtle, rgba(5, 150, 105, 0.1))',
              borderColor: 'var(--theme-border-subtle, rgba(5, 150, 105, 0.25))',
              color: 'var(--theme-primary, #059669)',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: 'var(--theme-primary, #059669)' }}
            />
            Store Owner Portal
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Store Owner Authentication
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
              Store Owners access BillingBuddy via a secure, single-use activation link delivered to
              their WhatsApp or sign in with registered credentials.
            </p>
          </div>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-950/40 p-3.5 text-xs text-rose-700 dark:text-rose-300 text-left flex items-start gap-2.5 transition-all"
          >
            <svg
              className="w-4 h-4 text-rose-500 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          {/* Identifier field */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="owner-identifier">
              Phone or Email
            </label>
            <input
              id="owner-identifier"
              type="text"
              value={identifier}
              onChange={handleIdentifierChange}
              required
              autoComplete="username"
              placeholder="+919876543210 or owner@store.com"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 transition-colors"
              style={{
                outlineColor: 'var(--theme-primary, #059669)',
              }}
            />
          </div>

          {/* Password field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor="owner-password">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium cursor-pointer"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="owner-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 transition-colors"
            />
          </div>

          {/* Optional Store Slug */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400" htmlFor="owner-slug">
                Store Slug{' '}
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">(Optional)</span>
              </label>
            </div>
            <input
              id="owner-slug"
              type="text"
              value={tenantSlug}
              onChange={handleTenantSlugChange}
              placeholder="e.g. metro-mart-pune"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 transition-colors"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Only required if you manage multiple stores. Leave empty to use your default store.
            </p>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={!identifier.trim() || !password || isSubmitting}
            className="w-full rounded-xl py-2.5 px-4 text-sm font-semibold text-white shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-2"
            style={{
              backgroundColor: 'var(--theme-primary, #059669)',
            }}
          >
            {isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing In...
              </span>
            ) : (
              'Sign In to Store'
            )}
          </button>
        </form>

        {/* WhatsApp activation reminder */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-4 text-xs text-slate-600 dark:text-slate-400 text-left space-y-1.5">
          <div className="font-semibold text-slate-800 dark:text-slate-200">First time here?</div>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Open the activation link sent to your WhatsApp by the BillingBuddy administrator to set
            up your password and claim your store.
          </p>
        </div>
      </div>
    </div>
  );
}

export default OwnerLoginPage;