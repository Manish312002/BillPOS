import React, { useCallback, useEffect, useState, useRef } from 'react';
import { apiClient } from '../../../services/api/client.js';
import { CreateTenantModal } from '../components/CreateTenantModal.jsx';
import { WhatsAppShareModal } from '../components/WhatsAppShareModal.jsx';
import { TenantDetailModal, getInvitationStatusBadge } from '../components/TenantDetailModal.jsx';
import { TenantLifecycleModal } from '../components/TenantLifecycleModal.jsx';

function getTenantStatusBadge(status) {
  switch (status) {
    case 'ACTIVE':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Active
        </span>
      );
    case 'INVITED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          Invited
        </span>
      );
    case 'SUSPENDED':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
          Suspended
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
          {status || 'Unknown'}
        </span>
      );
  }
}

export function PlatformTenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [shareInvitationData, setShareInvitationData] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [lifecycleModalData, setLifecycleModalData] = useState(null);
  const [successBanner, setSuccessBanner] = useState(null);

  // AbortController ref to cancel obsolete inflight search queries
  const abortControllerRef = useRef(null);

  // Debounce search input by 300ms to avoid flooding backend with keystroke requests
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchTenants = useCallback(async () => {
    // Cancel previous inflight request if still running
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = {
        page: currentPage,
        limit: 20,
      };

      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }

      if (statusFilter !== 'ALL') {
        params.status = statusFilter;
      }

      const res = await apiClient.get('/platform/tenants', {
        params,
        signal: controller.signal,
      });
      const data = res.data?.data || res.data;

      setTenants(data.tenants || []);
      if (data.pagination) {
        setPagination(data.pagination);
      }
      setLoading(false);
    } catch (err) {
      // Do not surface abort errors as failures
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      setError(err.message || 'Failed to load tenants. Please check your connection and retry.');
      setLoading(false);
    }
  }, [currentPage, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchTenants();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchTenants]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setDebouncedSearch(search);
    setCurrentPage(1);
  };

  const handleStatusChange = (status) => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setCurrentPage(newPage);
    }
  };

  const [resendingTenantId, setResendingTenantId] = useState(null);

  const handleResendFromTable = async (tenantId) => {
    if (resendingTenantId) return;
    setResendingTenantId(tenantId);
    try {
      const res = await apiClient.post(`/platform/tenants/${tenantId}/invitations/resend`);
      const data = res.data?.data || res.data;
      setShareInvitationData(data);
      fetchTenants();
    } catch (err) {
      setError(err.message || 'Failed to resend invitation');
    } finally {
      setResendingTenantId(null);
    }
  };

  const handleTenantCreated = (creationData) => {
    setIsCreateOpen(false);
    fetchTenants();
    // Hand over invitation data to WhatsApp sharing modal
    setShareInvitationData(creationData);
  };

  const handleLifecycleSuccess = (updatedTenant) => {
    setTenants((prevTenants) =>
      prevTenants.map((t) =>
        t.id === updatedTenant.id ? { ...t, ...updatedTenant, status: updatedTenant.status } : t
      )
    );
    setSuccessBanner(
      `Store "${updatedTenant.tradeName || updatedTenant.legalName}" successfully ${
        updatedTenant.status === 'SUSPENDED' ? 'suspended' : 'reactivated'
      }.`
    );
    setTimeout(() => {
      setSuccessBanner(null);
    }, 5000);
  };

  return (
    <div className="space-y-6">
      {/* Success Notification Banner */}
      {successBanner && (
        <div className="flex items-center justify-between p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs transition-colors">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:opacity-80 p-0.5 cursor-pointer"
            aria-label="Dismiss banner"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4 transition-colors">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors">
            Tenant Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 transition-colors">
            Manage stores, invite store owners, and track onboarding status across the platform.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          style={{ backgroundColor: 'var(--theme-primary)' }}
          className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-xs font-semibold text-white shadow hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all cursor-pointer"
        >
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              d="M12 4v16m8-8H4"
            />
          </svg>
          Create Tenant
        </button>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg
                className="h-4 w-4 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by store name, legal name, slug, or phone..."
              className="block w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 pl-9 pr-10 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCurrentPage(1);
                }}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        </form>

        {/* Filter Tabs & Refresh */}
        <div className="flex items-center space-x-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-1 text-xs shadow-2xs">
            {['ALL', 'INVITED', 'ACTIVE', 'SUSPENDED'].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => handleStatusChange(status)}
                style={
                  statusFilter === status
                    ? { backgroundColor: 'var(--theme-primary)', color: '#ffffff' }
                    : {}
                }
                className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                  statusFilter === status
                    ? 'shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={fetchTenants}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
            title="Refresh directory"
            aria-label="Refresh directory"
          >
            <svg
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              style={loading ? { color: 'var(--theme-primary)' } : {}}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-300 flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <svg
              className="h-5 w-5 text-rose-400 flex-shrink-0"
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
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchTenants}
            className="rounded px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Directory Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 overflow-hidden shadow-xs transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-medium uppercase tracking-wider text-[11px] transition-colors">
              <tr>
                <th scope="col" className="px-4 py-3.5">
                  Store / Business
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Slug
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Owner Contact
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Tenant Status
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Invitation Status
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Onboarding
                </th>
                <th scope="col" className="px-4 py-3.5">
                  Created
                </th>
                <th scope="col" className="px-4 py-3.5 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {/* Loading Skeletons */}
              {loading && tenants.length === 0 && (
                <>
                  {[...Array(5)].map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="px-4 py-4">
                        <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-32 mb-1.5" />
                        <div className="h-2.5 bg-slate-100 dark:bg-slate-800/60 rounded w-24" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-20" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-28" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded-full w-16" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-5 bg-slate-200 dark:bg-slate-800 rounded-full w-20" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-16" />
                      </td>
                      <td className="px-4 py-4">
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-20" />
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded w-16 ml-auto" />
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {/* Empty State */}
              {!loading && tenants.length === 0 && (
                <tr>
                  <td colSpan="8" className="px-4 py-16 text-center text-slate-500 dark:text-slate-400">
                    <svg
                      className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600 mb-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.5"
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                      />
                    </svg>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-300">No tenants found</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      {search || statusFilter !== 'ALL'
                        ? 'Try clearing your search query or status filter.'
                        : 'Get started by creating your first store tenant.'}
                    </p>
                  </td>
                </tr>
              )}

              {/* Data Rows */}
              {tenants.map((tenant) => {
                const displayName = tenant.tradeName || tenant.legalName;
                const ownerPhone = tenant.currentInvitation?.nominatedPhone || '—';
                const ownerEmail = tenant.currentInvitation?.nominatedEmail || '—';
                const onboarding = tenant.onboarding;

                return (
                  <tr key={tenant.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    {/* Store / Legal Name */}
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{displayName}</div>
                      {tenant.tradeName && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {tenant.legalName}
                        </div>
                      )}
                    </td>

                    {/* Slug */}
                    <td
                      className="px-4 py-3.5 font-mono text-xs font-medium"
                      style={{ color: 'var(--theme-primary)' }}
                    >
                      {tenant.slug}
                    </td>

                    {/* Owner Contact */}
                    <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                      <div className="font-mono text-[11px]">{ownerPhone}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                        {ownerEmail}
                      </div>
                    </td>

                    {/* Tenant Status */}
                    <td className="px-4 py-3.5">{getTenantStatusBadge(tenant.status)}</td>

                    {/* Invitation Status */}
                    <td className="px-4 py-3.5">
                      {tenant.currentInvitation ? (
                        getInvitationStatusBadge(
                          tenant.currentInvitation.status,
                          tenant.currentInvitation.isExpired
                        )
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 text-[11px]">No invite</span>
                      )}
                    </td>

                    {/* Onboarding */}
                    <td className="px-4 py-3.5">
                      {onboarding?.isCompleted ? (
                        <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                          <svg
                            className="w-3.5 h-3.5 mr-1"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.5"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-slate-600 dark:text-slate-300 text-[11px]">
                          Step {onboarding?.currentStep || 1}/6
                        </span>
                      )}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 text-[11px]">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right space-x-2">
                      {tenant.status !== 'SUSPENDED' &&
                        tenant.currentInvitation &&
                        tenant.currentInvitation.status !== 'ACCEPTED' && (
                          <button
                            type="button"
                            disabled={resendingTenantId === tenant.id}
                            onClick={() => handleResendFromTable(tenant.id)}
                            className="inline-flex items-center px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {resendingTenantId === tenant.id ? 'Resending...' : 'Resend Invite'}
                          </button>
                        )}
                      {tenant.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => setLifecycleModalData({ tenant, action: 'SUSPEND' })}
                          className="inline-flex items-center px-2.5 py-1 rounded border border-rose-500/40 bg-rose-50 dark:bg-rose-600/20 hover:bg-rose-100 dark:hover:bg-rose-600/30 text-rose-700 dark:text-rose-400 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Suspend
                        </button>
                      )}
                      {tenant.status === 'SUSPENDED' && (
                        <button
                          type="button"
                          onClick={() => setLifecycleModalData({ tenant, action: 'REACTIVATE' })}
                          className="inline-flex items-center px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedTenantId(tenant.id)}
                        className="inline-flex items-center px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 transition-colors">
          <div>
            Showing{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {tenants.length === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1}
            </span>{' '}
            to{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </span>{' '}
            of <span className="font-semibold text-slate-800 dark:text-slate-200">{pagination.total}</span> tenants
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={!pagination.hasPrevPage || loading}
              className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Previous
            </button>
            <span className="px-2 text-slate-500 dark:text-slate-400">
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={!pagination.hasNextPage || loading}
              className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create Tenant Modal */}
      <CreateTenantModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={handleTenantCreated}
      />

      {/* Ephemeral WhatsApp Invitation Modal */}
      <WhatsAppShareModal
        isOpen={Boolean(shareInvitationData)}
        onClose={() => setShareInvitationData(null)}
        invitationData={shareInvitationData}
      />

      {/* Tenant Detail Modal */}
      <TenantDetailModal
        isOpen={Boolean(selectedTenantId)}
        tenantId={selectedTenantId}
        onClose={() => setSelectedTenantId(null)}
        onTenantUpdated={handleLifecycleSuccess}
        onResendInvitation={(data) => {
          setSelectedTenantId(null);
          setShareInvitationData(data);
          fetchTenants();
        }}
      />

      {/* Tenant Lifecycle (Suspend / Reactivate) Confirmation Modal */}
      <TenantLifecycleModal
        isOpen={Boolean(lifecycleModalData)}
        tenant={lifecycleModalData?.tenant}
        action={lifecycleModalData?.action}
        onClose={() => setLifecycleModalData(null)}
        onSuccess={handleLifecycleSuccess}
      />
    </div>
  );
}

export default PlatformTenantsPage;
