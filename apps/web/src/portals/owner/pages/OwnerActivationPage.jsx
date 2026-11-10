import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { validateOwnerInvitation, activateOwner } from '../../../app/store/authSlice';

/**
 * Extracts bearer token from URL fragment (#token=...) or query string (?token=...).
 */
function extractTokenFromLocation(location) {
  // 1. Primary transport: URL fragment (#token=...) to prevent HTTP/Referer leakage
  const hash = location?.hash || (typeof window !== 'undefined' ? window.location.hash : '') || '';
  const hashMatch = hash.match(/token=([^&]+)/);
  if (hashMatch) {
    return decodeURIComponent(hashMatch[1]);
  }

  // 2. Fallback: Query parameter (?token=...)
  const search =
    location?.search || (typeof window !== 'undefined' ? window.location.search : '') || '';
  const searchParams = new URLSearchParams(search);
  const searchToken = searchParams.get('token');
  if (searchToken) {
    return decodeURIComponent(searchToken);
  }

  return null;
}

export function OwnerActivationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const tokenFromUrl = extractTokenFromLocation(location);
  const capturedTokenRef = useRef(tokenFromUrl);

  if (tokenFromUrl && tokenFromUrl !== capturedTokenRef.current) {
    capturedTokenRef.current = tokenFromUrl;
  }

  // Safely extract token during render and preserve in ref + state
  // This guarantees the token survives React 19 StrictMode remounts and replaceState address bar sanitization
  const [token, setToken] = useState(() => capturedTokenRef.current);
  const [isValidating, setIsValidating] = useState(true);
  const [invitationData, setInvitationData] = useState(null);
  const [validationError, setValidationError] = useState(null);

  // Form state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    const rawToken = tokenFromUrl || capturedTokenRef.current || token;

    // Sanitize address bar immediately to prevent Referer or history leakage
    if (
      window.location.hash ||
      (window.location.search && window.location.search.includes('token='))
    ) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (!rawToken) {
      setIsValidating(false);
      setInvitationData(null);
      setValidationError(
        'No invitation token provided. Please open the activation link sent to your WhatsApp.'
      );
      return;
    }

    setToken(rawToken);
    setIsValidating(true);
    setValidationError(null);

    // Validate token with backend
    dispatch(validateOwnerInvitation({ token: rawToken }))
      .unwrap()
      .then((data) => {
        setInvitationData(data);
        setIsValidating(false);
      })
      .catch((err) => {
        setInvitationData(null);
        setValidationError(
          err.message ||
            'This invitation link is invalid, expired, or has already been accepted. Please contact your store administrator.'
        );
        setIsValidating(false);
      });
  }, [dispatch, location.key, location.hash, location.search]);

  // Password complexity checks
  const hasMinLength = password.length >= 10;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isPasswordValid =
    hasMinLength && hasUppercase && hasLowercase && hasDigit && hasSymbol && passwordsMatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token || !isPasswordValid || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await dispatch(activateOwner({ token, password })).unwrap();
      // On success, the session cookie is set and Redux is updated; navigate to owner portal
      navigate('/owner/overview', { replace: true });
    } catch (err) {
      setSubmitError(
        err.message || 'Failed to activate account. Please check your password or try again.'
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-xl shadow-slate-950/60 space-y-6">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="h-11 w-11 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
            BB
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-mono font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Store Owner Activation
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Activate Your Store</h1>
          <p className="text-xs text-slate-400">
            Set up your store owner credentials to access BillingBuddy POS.
          </p>
        </div>

        {/* Loading state */}
        {isValidating && (
          <div className="flex flex-col items-center justify-center py-8 space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <p className="text-xs text-slate-400">Verifying your invitation link...</p>
          </div>
        )}

        {/* Validation error */}
        {!isValidating && validationError && (
          <div className="rounded-lg border border-red-500/20 bg-red-950/40 p-4 text-left space-y-3">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <svg
                className="h-5 w-5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>Invitation Unavailable</span>
            </div>
            <p className="text-xs text-red-300 leading-relaxed">{validationError}</p>
            <div className="pt-2 border-t border-red-500/10">
              <button
                type="button"
                onClick={() => navigate('/owner/login')}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline"
              >
                Go to Store Owner Login
              </button>
            </div>
          </div>
        )}

        {/* Activation form */}
        {!isValidating && !validationError && invitationData && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Store details summary */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 space-y-1.5 text-xs text-left">
              <div className="text-slate-400">Store:</div>
              <div className="text-white font-medium text-sm">
                {invitationData.tenant?.tradeName || invitationData.tenant?.legalName}
              </div>
              <div className="text-slate-400 pt-1">Invited Contact:</div>
              <div className="text-slate-300 font-mono text-[11px]">
                {invitationData.invitedPhone} &bull; {invitationData.invitedEmail}
              </div>
            </div>

            {/* Error notice if submission failed */}
            {submitError && (
              <div className="rounded-lg border border-red-500/20 bg-red-950/40 p-3 text-xs text-red-300">
                {submitError}
              </div>
            )}

            {/* Password input */}
            <div className="space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300" htmlFor="new-password">
                  Create Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-slate-400 hover:text-slate-300"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Enter strong password"
              />
            </div>

            {/* Confirm password input */}
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-medium text-slate-300" htmlFor="confirm-password">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Re-enter password"
              />
            </div>

            {/* Password requirements checklist */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] space-y-1 text-left">
              <div className="font-semibold text-slate-400 mb-1">Password Requirements:</div>
              <div className={hasMinLength ? 'text-emerald-400' : 'text-slate-500'}>
                {hasMinLength ? '✓' : '•'} At least 10 characters
              </div>
              <div className={hasUppercase ? 'text-emerald-400' : 'text-slate-500'}>
                {hasUppercase ? '✓' : '•'} At least 1 uppercase letter
              </div>
              <div className={hasLowercase ? 'text-emerald-400' : 'text-slate-500'}>
                {hasLowercase ? '✓' : '•'} At least 1 lowercase letter
              </div>
              <div className={hasDigit ? 'text-emerald-400' : 'text-slate-500'}>
                {hasDigit ? '✓' : '•'} At least 1 number
              </div>
              <div className={hasSymbol ? 'text-emerald-400' : 'text-slate-500'}>
                {hasSymbol ? '✓' : '•'} At least 1 special character (!@#$%^&*...)
              </div>
              <div className={passwordsMatch ? 'text-emerald-400' : 'text-slate-500'}>
                {passwordsMatch ? '✓' : '•'} Passwords match
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={!isPasswordValid || isSubmitting}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed py-2.5 px-4 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              {isSubmitting ? 'Activating Store...' : 'Activate Store & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default OwnerActivationPage;
