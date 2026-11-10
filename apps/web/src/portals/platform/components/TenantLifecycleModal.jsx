import React, { useState } from 'react';
import { apiClient } from '../../../services/api/client.js';

/**
 * TenantLifecycleModal
 *
 * Handles Superadmin confirmation and reason submission for:
 * - Tenant Suspension (SUSPEND)
 * - Tenant Reactivation (REACTIVATE)
 *
 * Requirements:
 * - Clearly explains consequences of suspension/reactivation.
 * - Optional reason input, max 500 characters, trimmed.
 * - Character count indicator.
 * - Double-submit lock during API execution.
 * - Error alert banner on rejection.
 * - In-place parent notification on success.
 */
export function TenantLifecycleModal({ isOpen, tenant, action, onClose, onSuccess }) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !tenant) return null;

  const isSuspend = action === 'SUSPEND';
  const storeName = tenant.tradeName || tenant.legalName || 'Store';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (reason.length > 500) {
      setError('Reason cannot exceed 500 characters');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const endpoint = isSuspend
        ? `/platform/tenants/${tenant.id}/suspend`
        : `/platform/tenants/${tenant.id}/reactivate`;

      const payload = {
        reason: reason.trim() || undefined,
      };

      const res = await apiClient.post(endpoint, payload);
      const data = res.data?.data || res.data;

      if (onSuccess) {
        onSuccess(data);
      }
      onClose();
    } catch (err) {
      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        `Failed to ${isSuspend ? 'suspend' : 'reactivate'} store`;
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lifecycle-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 text-slate-900 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                isSuspend
                  ? 'border-rose-500/20 bg-rose-500/10 text-rose-500'
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
              }`}
            >
              {isSuspend ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>
            <div>
              <h3
                id="lifecycle-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-white"
              >
                {isSuspend ? 'Suspend Store' : 'Reactivate Store'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {storeName} <span className="font-mono text-[11px]">({tenant.slug})</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Content & Warning */}
        <div className="py-4 space-y-4">
          <div
            className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
              isSuspend
                ? 'border-rose-500/20 bg-rose-500/5 text-rose-700 dark:text-rose-300'
                : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {isSuspend ? (
              <p>
                <strong>Warning:</strong> Suspending this tenant will immediately revoke all active sessions for this store. The store owner and staff will be locked out and cannot log in until reactivated.
              </p>
            ) : (
              <p>
                <strong>Notice:</strong> Reactivating this store will restore access to store operations. Store owners and staff will need to authenticate with their credentials to establish a new session.
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="lifecycle-reason"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Reason <span className="text-slate-400 font-normal">(Optional, for audit log)</span>
              </label>
              <textarea
                id="lifecycle-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder={
                  isSuspend
                    ? 'e.g. Account suspended due to non-payment or compliance review'
                    : 'e.g. Account reactivated after billing dispute resolution'
                }
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors"
              />
              <div className="flex justify-end mt-1">
                <span className="text-[11px] text-slate-400 font-mono">
                  {reason.length}/500
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all disabled:opacity-50 cursor-pointer ${
                  isSuspend
                    ? 'bg-rose-600 hover:bg-rose-700 focus:ring-2 focus:ring-rose-500/50'
                    : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/50'
                }`}
              >
                {isSubmitting
                  ? isSuspend
                    ? 'Suspending...'
                    : 'Reactivating...'
                  : isSuspend
                  ? 'Confirm Suspension'
                  : 'Confirm Reactivation'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TenantLifecycleModal;
