import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { changePassword, logoutUser } from '../../../app/store/authSlice.js';

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
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
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
 * Mandatory First-Login Password Change Page
 * Enforces SEC-AUTH-08: Superadmin must change initial provisioned password before accessing platform dashboard.
 */
export function MandatoryPasswordChangePage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Policy validation checks
  const hasMinLength = newPassword.length >= 10;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasDigit = /[0-9]/.test(newPassword);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(newPassword);
  const passwordsMatch = newPassword && newPassword === confirmPassword;
  const isPolicySatisfied =
    hasMinLength && hasUppercase && hasLowercase && hasDigit && hasSpecial && passwordsMatch;

  const validate = () => {
    const errors = {};
    if (!currentPassword) {
      errors.currentPassword = 'Current password is required.';
    }
    if (!newPassword) {
      errors.newPassword = 'New password is required.';
    } else if (!hasMinLength || !hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
      errors.newPassword = 'New password does not meet complexity requirements.';
    }
    if (!confirmPassword) {
      errors.confirmPassword = 'Confirmation password is required.';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const resultAction = await dispatch(
        changePassword({
          currentPassword,
          newPassword,
        })
      );

      if (changePassword.fulfilled.match(resultAction)) {
        navigate('/platform/overview', { replace: true });
      } else {
        const errorMsg =
          resultAction.payload?.message ||
          'Failed to update password. Please check your current password.';
        setSubmitError(errorMsg);
      }
    } catch {
      setSubmitError('An unexpected network error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    await dispatch(logoutUser());
    navigate('/platform/login', { replace: true });
  };

  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-xl shadow-slate-950/50">
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="h-11 w-11 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-base shadow-sm mb-3">
              BB
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-800/80 text-[11px] font-mono font-medium text-amber-300 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Security Compliance Action
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white">
              Change Initial Password
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              As a security precaution for{' '}
              <span className="text-slate-200 font-medium">{user?.email || 'Superadmin'}</span>, you
              must set a personalized password before accessing the platform dashboard.
            </p>
          </div>

          {/* Alert Error Banner */}
          {submitError && (
            <div
              role="alert"
              className="mt-5 rounded-lg border border-rose-900/60 bg-rose-950/60 p-3 text-xs text-rose-200 flex items-start gap-2.5"
            >
              <AlertCircleIcon className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{submitError}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {/* Current Password */}
            <div className="space-y-1.5 text-left">
              <label
                htmlFor="current-password"
                className="block text-xs font-medium text-slate-300"
              >
                Current Provisioned Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <LockIcon className="h-4 w-4" />
                </div>
                <input
                  id="current-password"
                  name="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={isSubmitting}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (fieldErrors.currentPassword) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        currentPassword: null,
                      }));
                    }
                  }}
                  placeholder="••••••••••••"
                  aria-invalid={Boolean(fieldErrors.currentPassword)}
                  className="block w-full h-11 pl-10 pr-10 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  aria-label={
                    showCurrentPassword ? 'Hide current password' : 'Show current password'
                  }
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showCurrentPassword ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
              {fieldErrors.currentPassword && (
                <p className="text-xs text-rose-400 font-medium pl-1">
                  {fieldErrors.currentPassword}
                </p>
              )}
            </div>

            {/* New Password */}
            <div className="space-y-1.5 text-left">
              <label htmlFor="new-password" className="block text-xs font-medium text-slate-300">
                New Personalized Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <LockIcon className="h-4 w-4" />
                </div>
                <input
                  id="new-password"
                  name="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (fieldErrors.newPassword) {
                      setFieldErrors((prev) => ({ ...prev, newPassword: null }));
                    }
                  }}
                  placeholder="••••••••••••"
                  aria-invalid={Boolean(fieldErrors.newPassword)}
                  className="block w-full h-11 pl-10 pr-10 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showNewPassword ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
              {fieldErrors.newPassword && (
                <p className="text-xs text-rose-400 font-medium pl-1">{fieldErrors.newPassword}</p>
              )}
            </div>

            {/* Confirm New Password */}
            <div className="space-y-1.5 text-left">
              <label
                htmlFor="confirm-password"
                className="block text-xs font-medium text-slate-300"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <LockIcon className="h-4 w-4" />
                </div>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  disabled={isSubmitting}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        confirmPassword: null,
                      }));
                    }
                  }}
                  placeholder="••••••••••••"
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  className="block w-full h-11 pl-10 pr-10 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={
                    showConfirmPassword
                      ? 'Hide confirmation password'
                      : 'Show confirmation password'
                  }
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="text-xs text-rose-400 font-medium pl-1">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            {/* Password Policy Live Requirements Checklist */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-1.5 text-left">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Password Security Policy:
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div
                  className={`flex items-center gap-1.5 ${
                    hasMinLength ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>10+ characters</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    hasUppercase ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>Uppercase (A-Z)</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    hasLowercase ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>Lowercase (a-z)</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    hasDigit ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>Digit (0-9)</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    hasSpecial ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>Special character</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    passwordsMatch ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  <CheckIcon />
                  <span>Passwords match</span>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={isSubmitting || !isPolicySatisfied}
                className="w-full h-11 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <span>Update Password & Enter Control Panel</span>
                )}
              </button>

              <button
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="w-full py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Sign out and return to login
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default MandatoryPasswordChangePage;
