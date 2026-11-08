import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  loginSuperadmin,
  enrollTotp,
  confirmTotpEnrollment,
  verifyTotp,
  verifyRecoveryCode,
  acknowledgeRecoveryCodes,
  logoutUser,
} from '../../../app/store/authSlice.js';

function MailIcon({ className = 'h-4 w-4' }) {
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
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon({ className = 'h-4 w-4' }) {
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
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ className = 'h-4 w-4' }) {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = 'h-4 w-4' }) {
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
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function AlertCircleIcon({ className = 'h-4 w-4' }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function ShieldCheckIcon({ className = 'h-4 w-4' }) {
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
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function KeyIcon({ className = 'h-4 w-4' }) {
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
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
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

/**
 * Superadmin Login & Multi-Factor Authentication Component
 * Supports:
 * 1. Email/password credentials
 * 2. Mandatory TOTP enrollment & 6-digit confirmation
 * 3. Emergency recovery codes reveal & confirmation
 * 4. 6-digit TOTP code verification
 * 5. Emergency single-use recovery code verification
 */
export function SuperadminLoginPage({
  onSubmit,
  isLoading: externalLoading = false,
  error: externalError = null,
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { error: reduxError } = useSelector((state) => state.auth);

  // Workflow steps
  const [authStep, setAuthStep] = useState('CREDENTIALS');
  // 'CREDENTIALS' | 'TOTP_ENROLL' | 'RECOVERY_CODES' | 'TOTP_VERIFY' | 'RECOVERY_VERIFY'

  // Credential fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // 2FA inputs
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [enrollmentData, setEnrollmentData] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [post2faMustChangePassword, setPost2faMustChangePassword] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [hasConfirmedSavedCodes, setHasConfirmedSavedCodes] = useState(false);

  // UI state
  const [fieldErrors, setFieldErrors] = useState({});
  const [localError, setLocalError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = externalLoading || isSubmitting;
  const activeError = externalError || localError || reduxError;

  // Validation
  const validateCredentials = () => {
    const errors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCredentialSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!validateCredentials()) {
      return;
    }

    if (typeof onSubmit === 'function') {
      try {
        await onSubmit({ email: email.trim(), password });
      } catch (err) {
        setLocalError(err.message || 'Authentication failed. Please check your credentials.');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const resultAction = await dispatch(
        loginSuperadmin({
          identifier: email.trim(),
          password,
        })
      );

      if (loginSuperadmin.fulfilled.match(resultAction)) {
        const payload = resultAction.payload || {};
        if (payload.requiresTotpEnrollment) {
          // Fetch enrollment details
          const enrollAction = await dispatch(enrollTotp());
          if (enrollTotp.fulfilled.match(enrollAction)) {
            setEnrollmentData(enrollAction.payload);
            setAuthStep('TOTP_ENROLL');
          } else {
            setLocalError(enrollAction.payload?.message || 'Failed to initialize TOTP enrollment.');
          }
        } else if (payload.requiresSecondFactor) {
          setAuthStep('TOTP_VERIFY');
        } else if (payload.mustChangePassword) {
          navigate('/platform/change-password', { replace: true });
        } else {
          const from = location.state?.from;
          navigate(from || '/platform/overview', { replace: true });
        }
      } else {
        setLocalError(
          resultAction.payload?.message || 'Authentication failed. Please verify your credentials.'
        );
      }
    } catch {
      setLocalError('Network connection failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnrollConfirm = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!totpCode || totpCode.trim().length !== 6) {
      setLocalError('Please enter a valid 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    try {
      const confirmAction = await dispatch(
        confirmTotpEnrollment({
          code: totpCode.trim(),
          secret: enrollmentData?.secret,
        })
      );

      if (confirmTotpEnrollment.fulfilled.match(confirmAction)) {
        setRecoveryCodes(confirmAction.payload?.recoveryCodes || []);
        setPost2faMustChangePassword(Boolean(confirmAction.payload?.mustChangePassword));
        setAuthStep('RECOVERY_CODES');
      } else {
        setLocalError(
          confirmAction.payload?.message ||
            'Invalid confirmation code. Please verify the code in your app.'
        );
      }
    } catch {
      setLocalError('Network connection error while confirming enrollment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyTotp = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!totpCode || totpCode.trim().length !== 6) {
      setLocalError('Please enter a valid 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    try {
      const verifyAction = await dispatch(
        verifyTotp({
          code: totpCode.trim(),
        })
      );

      if (verifyTotp.fulfilled.match(verifyAction)) {
        if (verifyAction.payload?.mustChangePassword) {
          navigate('/platform/change-password', { replace: true });
        } else {
          const from = location.state?.from;
          navigate(from || '/platform/overview', { replace: true });
        }
      } else {
        setLocalError(
          verifyAction.payload?.message ||
            'Invalid authenticator code. Check your app and try again.'
        );
      }
    } catch {
      setLocalError('Network connection error while verifying code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyRecovery = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!recoveryCode || recoveryCode.trim().length < 8) {
      setLocalError('Please enter a valid emergency recovery code.');
      return;
    }

    setIsSubmitting(true);
    try {
      const recAction = await dispatch(
        verifyRecoveryCode({
          recoveryCode: recoveryCode.trim(),
        })
      );

      if (verifyRecoveryCode.fulfilled.match(recAction)) {
        if (recAction.payload?.isRecoveryCodeAckPending) {
          navigate('/platform/recovery-codes', { replace: true });
        } else if (recAction.payload?.mustChangePassword) {
          navigate('/platform/change-password', { replace: true });
        } else {
          const from = location.state?.from;
          navigate(from || '/platform/overview', { replace: true });
        }
      } else {
        setLocalError(
          recAction.payload?.message || 'Invalid or previously consumed recovery code.'
        );
      }
    } catch {
      setLocalError('Network connection error while verifying recovery code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinishRecoveryAck = async () => {
    setLocalError(null);
    setIsSubmitting(true);
    try {
      const ackAction = await dispatch(acknowledgeRecoveryCodes());
      if (acknowledgeRecoveryCodes.fulfilled.match(ackAction)) {
        if (post2faMustChangePassword) {
          navigate('/platform/change-password', { replace: true });
        } else {
          const from = location.state?.from;
          navigate(from || '/platform/overview', { replace: true });
        }
      } else {
        setLocalError(
          ackAction.payload?.message || 'Failed to acknowledge recovery codes on the server.'
        );
      }
    } catch {
      setLocalError('Network connection error while acknowledging recovery codes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetToLogin = async () => {
    await dispatch(logoutUser());
    setAuthStep('CREDENTIALS');
    setTotpCode('');
    setRecoveryCode('');
    setLocalError(null);
  };

  const copySecretKey = () => {
    if (enrollmentData?.secret) {
      navigator.clipboard.writeText(enrollmentData.secret);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const copyAllRecoveryCodes = () => {
    if (recoveryCodes.length > 0) {
      navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-xl shadow-slate-950/50">
          {/* Brand Header */}
          <div className="flex flex-col items-center text-center">
            <div className="h-11 w-11 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-base shadow-sm mb-3">
              BB
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-mono font-medium text-slate-300 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Platform Superadmin
            </div>

            {authStep === 'CREDENTIALS' && (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-white">Welcome Back</h1>
                <p className="text-sm text-slate-400 mt-1">
                  Sign in to your BillingBuddy control panel.
                </p>
              </>
            )}

            {authStep === 'TOTP_ENROLL' && (
              <>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Set Up Authenticator
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Connect your authenticator app to secure your account.
                </p>
              </>
            )}

            {authStep === 'RECOVERY_CODES' && (
              <>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Emergency Recovery Codes
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Save these single-use codes in a safe place.
                </p>
              </>
            )}

            {authStep === 'TOTP_VERIFY' && (
              <>
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Two-Factor Verification
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </>
            )}

            {authStep === 'RECOVERY_VERIFY' && (
              <>
                <h1 className="text-xl font-bold tracking-tight text-white">Emergency Recovery</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Enter an unused recovery code to verify your identity.
                </p>
              </>
            )}
          </div>

          {/* Alert Message Banner */}
          {activeError && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-rose-900/60 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-start gap-2.5 transition-colors"
            >
              <AlertCircleIcon className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{activeError}</div>
            </div>
          )}

          {/* STEP 1: CREDENTIALS */}
          {authStep === 'CREDENTIALS' && (
            <form onSubmit={handleCredentialSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5 text-left">
                <label
                  htmlFor="superadmin-email"
                  className="block text-xs font-medium text-slate-300"
                >
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <MailIcon className="h-4 w-4" />
                  </div>
                  <input
                    id="superadmin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={isLoading}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (fieldErrors.email) {
                        setFieldErrors((prev) => ({ ...prev, email: null }));
                      }
                    }}
                    placeholder="superadmin@billingbuddy.com"
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    className={`block w-full h-11 pl-10 pr-3.5 rounded-lg bg-slate-950 border text-sm text-white placeholder-slate-500 focus:outline-none transition-colors ${
                      fieldErrors.email
                        ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'
                        : 'border-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  />
                </div>
                {fieldErrors.email && (
                  <p id="email-error" className="text-xs text-rose-400 font-medium pl-1">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 text-left">
                <label
                  htmlFor="superadmin-password"
                  className="block text-xs font-medium text-slate-300"
                >
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <LockIcon className="h-4 w-4" />
                  </div>
                  <input
                    id="superadmin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    disabled={isLoading}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: null }));
                      }
                    }}
                    placeholder="••••••••••••"
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                    className={`block w-full h-11 pl-10 pr-10 rounded-lg bg-slate-950 border text-sm text-white placeholder-slate-500 focus:outline-none transition-colors ${
                      fieldErrors.password
                        ? 'border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500'
                        : 'border-slate-800 focus:border-sky-500 focus:ring-1 focus:ring-sky-500'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors focus:outline-none focus:text-sky-400 disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOffIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" className="text-xs text-rose-400 font-medium pl-1">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <span>Sign in to Control Panel</span>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: TOTP ENROLLMENT */}
          {authStep === 'TOTP_ENROLL' && (
            <form onSubmit={handleEnrollConfirm} className="mt-6 space-y-4" noValidate>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 text-left space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Authenticator Key
                  </span>
                  <button
                    type="button"
                    onClick={copySecretKey}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                  >
                    {copiedKey ? '✓ Copied' : 'Copy Key'}
                  </button>
                </div>
                <div className="font-mono text-xs text-sky-300 break-all bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800 select-all">
                  {enrollmentData?.secret || 'Generating secret...'}
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Enter this Base32 secret manually in Google Authenticator or Authy.
                </p>
              </div>

              <div className="space-y-1.5 text-left">
                <label
                  htmlFor="enrollment-code"
                  className="block text-xs font-medium text-slate-300"
                >
                  6-Digit Confirmation Code
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <KeyIcon className="h-4 w-4" />
                  </div>
                  <input
                    id="enrollment-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    disabled={isLoading}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="block w-full h-11 pl-10 pr-3.5 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono tracking-widest text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={isLoading || totpCode.length !== 6}
                  className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                      <span>Activating 2FA...</span>
                    </>
                  ) : (
                    <span>Confirm & Activate 2FA</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetToLogin}
                  className="w-full py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel and return to login
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: RECOVERY CODES REVEAL */}
          {authStep === 'RECOVERY_CODES' && (
            <div className="mt-6 space-y-4 text-left">
              <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 p-3 text-xs text-amber-200">
                ⚠️ Each recovery code can only be used once. Store them in your password manager.
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Single-Use Emergency Codes
                  </span>
                  <button
                    type="button"
                    onClick={copyAllRecoveryCodes}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                  >
                    {copiedCodes ? '✓ Copied All' : 'Copy All Codes'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs text-slate-200">
                  {recoveryCodes.map((code, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900 px-2 py-1.5 rounded border border-slate-800 text-center select-all"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 space-y-4">
                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-800 bg-slate-950/60 cursor-pointer hover:bg-slate-950 transition-colors">
                  <input
                    type="checkbox"
                    id="login-confirm-saved-codes"
                    checked={hasConfirmedSavedCodes}
                    onChange={(e) => setHasConfirmedSavedCodes(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-sky-500 focus:ring-offset-slate-950 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 select-none leading-relaxed">
                    I confirm that I have copied and securely stored all 8 emergency recovery codes.
                  </span>
                </label>

                <button
                  type="button"
                  onClick={handleFinishRecoveryAck}
                  disabled={!hasConfirmedSavedCodes || isSubmitting}
                  className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                      <span>Confirming with Server...</span>
                    </>
                  ) : (
                    <span>I Have Securely Saved My Recovery Codes →</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: TOTP 6-DIGIT VERIFICATION */}
          {authStep === 'TOTP_VERIFY' && (
            <form onSubmit={handleVerifyTotp} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5 text-left">
                <label htmlFor="totp-code" className="block text-xs font-medium text-slate-300">
                  6-Digit Authenticator Code
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <KeyIcon className="h-4 w-4" />
                  </div>
                  <input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    disabled={isLoading}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="block w-full h-11 pl-10 pr-3.5 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono tracking-widest text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={isLoading || totpCode.length !== 6}
                  className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <span>Verify Code & Continue</span>
                  )}
                </button>

                <div className="flex flex-col gap-1.5 pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('RECOVERY_VERIFY');
                      setLocalError(null);
                    }}
                    className="text-xs text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                  >
                    Lost access? Use emergency recovery code
                  </button>

                  <button
                    type="button"
                    onClick={handleResetToLogin}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    ← Return to credential login
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* STEP 5: RECOVERY CODE VERIFICATION */}
          {authStep === 'RECOVERY_VERIFY' && (
            <form onSubmit={handleVerifyRecovery} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5 text-left">
                <label htmlFor="recovery-code" className="block text-xs font-medium text-slate-300">
                  Emergency Recovery Code
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <KeyIcon className="h-4 w-4" />
                  </div>
                  <input
                    id="recovery-code"
                    type="text"
                    required
                    disabled={isLoading}
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.trim())}
                    placeholder="XXXX-XXXX-XXXX"
                    className="block w-full h-11 pl-10 pr-3.5 rounded-lg bg-slate-950 border border-slate-800 text-sm font-mono tracking-wider text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={isLoading || !recoveryCode.trim()}
                  className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                      <span>Verifying Recovery Code...</span>
                    </>
                  ) : (
                    <span>Redeem Code & Authenticate</span>
                  )}
                </button>

                <div className="flex flex-col gap-1.5 pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('TOTP_VERIFY');
                      setLocalError(null);
                    }}
                    className="text-xs text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                  >
                    Return to 6-digit authenticator code
                  </button>

                  <button
                    type="button"
                    onClick={handleResetToLogin}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    ← Return to credential login
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Security & Access Notice */}
          <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-sky-500 shrink-0" />
            <span>Protected by authenticator app (TOTP) two-factor authentication</span>
          </div>
        </div>

        {/* Navigation Back Link */}
        <div className="mt-5 text-center">
          <Link
            to="/"
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1"
          >
            <span>←</span>
            <span>Return to Portal Index</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default SuperadminLoginPage;
