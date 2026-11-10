import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../services/api/client.js';
import { TenantLifecycleModal } from './TenantLifecycleModal.jsx';

function getStatusBadge(status) {
  switch (status) {
    case 'ACTIVE':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Active
        </span>
      );
    case 'INVITED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          Invited
        </span>
      );
    case 'SUSPENDED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          Suspended
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          {status || 'Unknown'}
        </span>
      );
  }
}

export function getInvitationStatusBadge(status, isExpired) {
  switch (status) {
    case 'INVITED_PENDING_ACCEPTANCE':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          Pending Acceptance
        </span>
      );
    case 'ACCEPTED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Accepted
        </span>
      );
    case 'SUPERSEDED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          Superseded
        </span>
      );
    case 'REVOKED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          Revoked
        </span>
      );
    case 'EXPIRED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/25">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
          Expired
        </span>
      );
    default:
      if (isExpired) {
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
            Expired
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          {status || 'Pending'}
        </span>
      );
  }
}

const ONBOARDING_STEPS = [
  { step: 1, label: 'Store Profile' },
  { step: 2, label: 'Tax & Categories' },
  { step: 3, label: 'Catalog & Stock' },
  { step: 4, label: 'POS Terminal' },
  { step: 5, label: 'Payment Setup' },
  { step: 6, label: 'Go-Live Verification' },
];

/**
 * Superadmin Tenant Detail & Audit Modal
 *
 * Fetches and displays tenant profile, onboarding step progress, current invitation,
 * and historical invitations. Adheres strictly to security guarantees:
 * zero raw tokens or token hashes are queried or exposed.
 */
export function TenantDetailModal({ isOpen, tenantId, onClose, onResendInvitation, onTenantUpdated }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [lifecycleAction, setLifecycleAction] = useState(null);

  useEffect(() => {
    if (!isOpen || !tenantId) {
      setTenant(null);
      setError(null);
      return;
    }

    let isMounted = true;
    const fetchTenant = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get(`/platform/tenants/${tenantId}`);
        if (isMounted) {
          setTenant(res.data?.data || res.data);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to retrieve tenant details');
          setLoading(false);
        }
      }
    };

    fetchTenant();
    return () => {
      isMounted = false;
    };
  }, [isOpen, tenantId]);

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2000);
  };

  const handleResendInvitation = async () => {
    if (!tenant || isResending) return;
    setIsResending(true);
    setResendError(null);
    try {
      const res = await apiClient.post(`/platform/tenants/${tenant.id}/invitations/resend`);
      const data = res.data?.data || res.data;

      // Refresh tenant details to reflect updated invitation status
      const detailRes = await apiClient.get(`/platform/tenants/${tenant.id}`);
      setTenant(detailRes.data?.data || detailRes.data);

      if (onResendInvitation) {
        onResendInvitation({
          tenant: data?.tenant || tenant,
          invitation: data?.invitation || data,
        });
      }
    } catch (err) {
      setResendError(err.message || 'Failed to reissue invitation');
    } finally {
      setIsResending(false);
    }
  };

  if (!isOpen) return null;

  const currentStep = tenant?.onboarding?.currentStep || 1;
  const isCompleted = tenant?.onboarding?.isCompleted || false;
  const progressPct = isCompleted ? 100 : Math.round((currentStep / 6) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs transition-opacity duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tenant-detail-title"
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl text-slate-900 dark:text-slate-100 overflow-hidden transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 backdrop-blur shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border font-bold text-base transition-colors"
              style={{
                backgroundColor: 'var(--theme-bg-subtle, rgba(14, 165, 233, 0.1))',
                borderColor: 'var(--theme-border-subtle, rgba(14, 165, 233, 0.2))',
                color: 'var(--theme-primary, #0ea5e9)',
              }}
            >
              {(tenant?.tradeName || tenant?.legalName || 'T').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id="tenant-detail-title"
                  className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate"
                >
                  {tenant?.tradeName || tenant?.legalName || 'Tenant Details'}
                </h3>
                {tenant && getStatusBadge(tenant.status)}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  Slug: <span className="font-semibold" style={{ color: 'var(--theme-primary, #0ea5e9)' }}>{tenant?.slug || '...'}</span>
                </span>
                {tenant?.slug && (
                  <button
                    type="button"
                    onClick={() => handleCopy(tenant.slug, 'slug')}
                    className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer"
                    title="Copy slug to clipboard"
                  >
                    {copiedKey === 'slug' ? (
                      <span className="text-[10px] text-emerald-500 font-medium font-sans">Copied!</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
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

        {/* Loading State */}
        {loading && (
          <div className="py-20 text-center text-slate-400 space-y-3">
            <svg
              className="animate-spin mx-auto h-9 w-9 text-sky-500"
              style={{ color: 'var(--theme-primary, #0ea5e9)' }}
              fill="none"
              viewBox="0 0 24 24"
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
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Loading tenant details...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="m-6 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-300">
            <div className="flex items-center space-x-2.5">
              <svg
                className="h-5 w-5 text-rose-500 shrink-0"
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
              <span className="font-medium">{error}</span>
            </div>
          </div>
        )}

        {/* Content Body */}
        {!loading && !error && tenant && (
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6">
            {/* Store Information */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Store Information
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 transition-colors">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-medium">Legal Business Name</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block mt-1 text-xs">
                    {tenant.legalName}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 transition-colors">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-medium">Trade / Store Name</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block mt-1 text-xs">
                    {tenant.tradeName || '—'}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-medium">Tenant ID</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(tenant.id, 'id')}
                      className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                    >
                      {copiedKey === 'id' ? (
                        <span className="text-emerald-500 font-semibold">Copied!</span>
                      ) : (
                        'Copy'
                      )}
                    </button>
                  </div>
                  <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 block mt-1 truncate" title={tenant.id}>
                    {tenant.id}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5 transition-colors">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-medium">Created At</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200 block mt-1 text-xs">
                    {new Date(tenant.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
              </div>
            </div>

            {/* Onboarding Progress */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Store Onboarding Progress
                  </h4>
                </div>
                <span
                  className="text-xs font-bold"
                  style={{
                    color: isCompleted ? '#10b981' : 'var(--theme-primary, #0ea5e9)',
                  }}
                >
                  {isCompleted ? 'Completed (100%)' : `Step ${currentStep} of 6 (${progressPct}%)`}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 dark:bg-slate-800/80 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
                <div
                  className="h-2 rounded-full transition-all duration-500 shadow-sm"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: isCompleted ? '#10b981' : 'var(--theme-primary, #0ea5e9)',
                  }}
                />
              </div>

              {/* Step Flow Indicators */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-3">
                {ONBOARDING_STEPS.map((s) => {
                  const stepDone = isCompleted || s.step < currentStep;
                  const stepActive = !isCompleted && s.step === currentStep;
                  return (
                    <div
                      key={s.step}
                      className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                        stepDone
                          ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : stepActive
                          ? 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold ring-1'
                          : 'border-slate-200/60 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-950/20 text-slate-400 dark:text-slate-500'
                      }`}
                      style={
                        stepActive
                          ? {
                              borderColor: 'var(--theme-border-subtle, rgba(14, 165, 233, 0.4))',
                              backgroundColor: 'var(--theme-bg-subtle, rgba(14, 165, 233, 0.08))',
                              color: 'var(--theme-primary, #0ea5e9)',
                              boxShadow: '0 0 0 1px var(--theme-ring, rgba(14, 165, 233, 0.25))',
                            }
                          : {}
                      }
                    >
                      <div className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mb-0.5">
                        {stepDone ? (
                          <svg className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <span>{s.step}</span>
                        )}
                      </div>
                      <span className="text-[10px] leading-tight line-clamp-1">{s.label}</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2.5 text-xs text-slate-600 dark:text-slate-400">
                {isCompleted
                  ? 'Store onboarding is fully complete and active.'
                  : `Store is currently completing onboarding step ${currentStep}.`}
              </div>
            </div>

            {/* Current Invitation */}
            {tenant.currentInvitation && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Latest Owner Invitation
                  </h4>
                </div>
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 space-y-3.5 text-xs transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-slate-500 dark:text-slate-400 block text-[11px] font-medium">Recipient Phone & Email</span>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-slate-800 dark:text-slate-200 font-medium">
                        <span className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800">
                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {tenant.currentInvitation.nominatedPhone || '—'}
                        </span>
                        <span className="text-slate-400">&bull;</span>
                        <span className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800">
                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                          </svg>
                          {tenant.currentInvitation.nominatedEmail || '—'}
                        </span>
                      </div>
                    </div>
                    <div>
                      {getInvitationStatusBadge(
                        tenant.currentInvitation.status,
                        tenant.currentInvitation.isExpired
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-t border-slate-200/80 dark:border-slate-800/80 pt-3 text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-600 dark:text-slate-400">Sent:</span>
                      <span className="text-slate-900 dark:text-slate-200 font-medium">
                        {new Date(tenant.currentInvitation.createdAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-600 dark:text-slate-400">Expires:</span>
                      <span className="text-slate-900 dark:text-slate-200 font-medium">
                        {new Date(tenant.currentInvitation.expiresAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Resend Invitation Button */}
                  {tenant.status !== 'SUSPENDED' &&
                    tenant.currentInvitation.status !== 'ACCEPTED' && (
                      <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          Need to reissue or extend this invitation?
                        </span>
                        <button
                          type="button"
                          disabled={isResending}
                          onClick={handleResendInvitation}
                          className="inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                        >
                          {isResending ? (
                            <>
                              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Reissuing Link...
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Resend Invitation
                            </>
                          )}
                        </button>
                      </div>
                    )}

                  {resendError && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300 font-medium">
                      {resendError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Invitation History Timeline */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Invitation History ({tenant.invitationHistory?.length || 0})
                </h4>
              </div>
              {!tenant.invitationHistory || tenant.invitationHistory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  <svg className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p>No invitation history recorded for this store.</p>
                </div>
              ) : (
                <div className="border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/80 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800 font-semibold text-[11px]">
                      <tr>
                        <th className="px-3.5 py-2.5">Recipient</th>
                        <th className="px-3.5 py-2.5">Status</th>
                        <th className="px-3.5 py-2.5">Created</th>
                        <th className="px-3.5 py-2.5">Expires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/60 bg-white dark:bg-slate-950/20">
                      {tenant.invitationHistory.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-3.5 py-2.5 font-mono text-[11px]">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{inv.nominatedPhone}</div>
                            <div className="text-slate-500 dark:text-slate-400 text-[10px]">{inv.nominatedEmail}</div>
                          </td>
                          <td className="px-3.5 py-2.5">
                            {getInvitationStatusBadge(inv.status, inv.isExpired)}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                            {new Date(inv.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                            {new Date(inv.expiresAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {tenant ? (
                <span>
                  Status: <strong className="text-slate-700 dark:text-slate-300 font-semibold">{tenant.status}</strong>
                </span>
              ) : null}
            </div>
            {tenant?.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => setLifecycleAction('SUSPEND')}
                className="inline-flex items-center px-2.5 py-1 rounded-lg border border-rose-500/40 bg-rose-50 dark:bg-rose-600/20 hover:bg-rose-100 dark:hover:bg-rose-600/30 text-rose-700 dark:text-rose-400 text-xs font-medium transition-colors cursor-pointer"
              >
                Suspend Tenant
              </button>
            )}
            {tenant?.status === 'SUSPENDED' && (
              <button
                type="button"
                onClick={() => setLifecycleAction('REACTIVATE')}
                className="inline-flex items-center px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium transition-colors cursor-pointer"
              >
                Reactivate Tenant
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-colors cursor-pointer shadow-xs"
          >
            Close
          </button>
        </div>
      </div>

      <TenantLifecycleModal
        isOpen={Boolean(lifecycleAction)}
        tenant={tenant}
        action={lifecycleAction}
        onClose={() => setLifecycleAction(null)}
        onSuccess={(updatedTenant) => {
          setTenant((prev) => ({ ...prev, ...updatedTenant, status: updatedTenant.status }));
          if (onTenantUpdated) {
            onTenantUpdated(updatedTenant);
          }
        }}
      />
    </div>
  );
}

export default TenantDetailModal;