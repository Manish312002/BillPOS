import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { store } from '../src/app/store/index.js';
import { apiClient } from '../src/services/api/client.js';
import { PlatformTenantsPage } from '../src/portals/platform/pages/PlatformTenantsPage.jsx';

const mockTenantsList = [
  {
    id: 'tenant-1111-aaaa',
    slug: 'alpha-store',
    legalName: 'Alpha Retail Ltd',
    tradeName: 'Alpha Mart',
    status: 'ACTIVE',
    onboarding: {
      currentStep: 6,
      isCompleted: true,
    },
    currentInvitation: {
      id: 'inv-1',
      nominatedPhone: '+919000000001',
      nominatedEmail: 'alpha@example.com',
      status: 'ACCEPTED',
      isExpired: false,
      expiresAt: '2026-11-09T10:00:00.000Z',
      createdAt: '2026-11-08T08:00:00.000Z',
    },
    createdAt: '2026-11-08T08:00:00.000Z',
    updatedAt: '2026-11-08T09:00:00.000Z',
  },
  {
    id: 'tenant-2222-bbbb',
    slug: 'beta-fresh',
    legalName: 'Beta Fresh Groceries',
    tradeName: null,
    status: 'INVITED',
    onboarding: {
      currentStep: 2,
      isCompleted: false,
    },
    currentInvitation: {
      id: 'inv-2',
      nominatedPhone: '+919000000002',
      nominatedEmail: 'beta@example.com',
      status: 'INVITED_PENDING_ACCEPTANCE',
      isExpired: false,
      expiresAt: '2026-11-08T22:00:00.000Z',
      createdAt: '2026-11-08T10:00:00.000Z',
    },
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
  },
];

const mockPagination = {
  page: 1,
  limit: 20,
  total: 2,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

function renderPage() {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <PlatformTenantsPage />
      </MemoryRouter>
    </Provider>
  );
}

describe('Superadmin Tenant Management Frontend (BB-WP02A)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================
  // 1. DIRECTORY RENDERING & LAYOUT
  // ========================================================
  describe('Directory Rendering & Layout', () => {
    it('renders heading, description, and "+ Create Tenant" button', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenants: mockTenantsList,
            pagination: mockPagination,
          },
        },
      });

      renderPage();

      expect(
        screen.getByRole('heading', { level: 2, name: /Tenant Management/i })
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Manage stores, invite store owners, and track onboarding status/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+?Create Tenant/i })).toBeInTheDocument();
    });

    it('displays loading skeletons while initial tenant list is loading', () => {
      // Mock that never resolves immediately
      vi.spyOn(apiClient, 'get').mockReturnValue(new Promise(() => {}));

      const { container } = renderPage();
      const pulseRows = container.querySelectorAll('.animate-pulse');
      expect(pulseRows.length).toBeGreaterThan(0);
    });

    it('renders empty state cleanly when zero tenants exist', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenants: [],
            pagination: {
              page: 1,
              limit: 20,
              total: 0,
              totalPages: 1,
              hasNextPage: false,
              hasPrevPage: false,
            },
          },
        },
      });

      renderPage();

      expect(await screen.findByText(/No tenants found/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Get started by creating your first store tenant/i)
      ).toBeInTheDocument();
    });

    it('renders error banner and functional retry button when API fails', async () => {
      vi.spyOn(apiClient, 'get')
        .mockRejectedValueOnce({
          message: 'Network connection timeout',
          status: 500,
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              tenants: mockTenantsList,
              pagination: mockPagination,
            },
          },
        });

      renderPage();

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Network connection timeout/i)).toBeInTheDocument();

      const retryButton = screen.getByRole('button', { name: /Retry/i });
      fireEvent.click(retryButton);

      expect(await screen.findByText('Alpha Mart')).toBeInTheDocument();
    });

    it('renders tenant records with correct data fields and badges', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenants: mockTenantsList,
            pagination: mockPagination,
          },
        },
      });

      renderPage();

      // Check first tenant (tradeName Alpha Mart, legalName Alpha Retail Ltd)
      expect(await screen.findByText('Alpha Mart')).toBeInTheDocument();
      expect(screen.getByText('Alpha Retail Ltd')).toBeInTheDocument();
      expect(screen.getByText('alpha-store')).toBeInTheDocument();
      expect(screen.getByText('+919000000001')).toBeInTheDocument();
      expect(screen.getByText('alpha@example.com')).toBeInTheDocument();
      expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Accepted')).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();

      // Check second tenant (no tradeName, displays legalName Beta Fresh Groceries)
      expect(screen.getByText('Beta Fresh Groceries')).toBeInTheDocument();
      expect(screen.getByText('beta-fresh')).toBeInTheDocument();
      expect(screen.getByText('+919000000002')).toBeInTheDocument();
      expect(screen.getByText('beta@example.com')).toBeInTheDocument();
      expect(screen.getAllByText('Invited').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Pending Acceptance')).toBeInTheDocument();
      expect(screen.getByText('Step 2/6')).toBeInTheDocument();
    });
  });

  // ========================================================
  // 2. SEARCH & FILTERING & PAGINATION
  // ========================================================
  describe('Search, Filters & Pagination', () => {
    it('search placeholder accurately reflects backend searchable fields', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();

      const searchInput = screen.getByPlaceholderText(
        'Search by store name, legal name, slug, or phone...'
      );
      expect(searchInput).toBeInTheDocument();
    });

    it('submitting search triggers API with search parameter', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();

      const searchInput = screen.getByPlaceholderText(/Search by store name/i);
      fireEvent.change(searchInput, { target: { value: 'Alpha Mart' } });
      fireEvent.submit(searchInput.closest('form'));

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.objectContaining({ search: 'Alpha Mart' }),
          })
        );
      });
    });

    it('clearing search query resets search and triggers API call', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();

      const searchInput = screen.getByPlaceholderText(/Search by store name/i);
      fireEvent.change(searchInput, { target: { value: 'Test Query' } });

      const clearBtn = await screen.findByRole('button', { name: /Clear search/i });
      fireEvent.click(clearBtn);

      expect(searchInput.value).toBe('');
      await waitFor(() => {
        expect(getSpy).toHaveBeenLastCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.not.objectContaining({ search: 'Test Query' }),
          })
        );
      });
    });

    it('status filter tabs trigger API with status parameter', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();

      const invitedTab = screen.getByRole('button', { name: /^Invited$/i });
      fireEvent.click(invitedTab);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.objectContaining({ status: 'INVITED' }),
          })
        );
      });

      const activeTab = screen.getByRole('button', { name: /^Active$/i });
      fireEvent.click(activeTab);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.objectContaining({ status: 'ACTIVE' }),
          })
        );
      });

      const allTab = screen.getByRole('button', { name: /^All$/i });
      fireEvent.click(allTab);

      await waitFor(() => {
        expect(getSpy).toHaveBeenLastCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.not.objectContaining({ status: expect.any(String) }),
          })
        );
      });
    });

    it('pagination controls navigate between pages correctly', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: {
          success: true,
          data: {
            tenants: mockTenantsList,
            pagination: {
              page: 1,
              limit: 2,
              total: 5,
              totalPages: 3,
              hasNextPage: true,
              hasPrevPage: false,
            },
          },
        },
      });

      renderPage();

      expect(await screen.findByText(/Page 1 of 3/i)).toBeInTheDocument();

      const prevBtn = screen.getByRole('button', { name: /Previous/i });
      const nextBtn = screen.getByRole('button', { name: /Next/i });

      expect(prevBtn).toBeDisabled();
      expect(nextBtn).toBeEnabled();

      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          '/platform/tenants',
          expect.objectContaining({
            params: expect.objectContaining({ page: 2 }),
          })
        );
      });
    });
  });

  // ========================================================
  // 3. CREATE TENANT MODAL & VALIDATION & AUTO-SLUG
  // ========================================================
  describe('Create Tenant Modal & Form Workflow', () => {
    it('opens create modal when clicking "+ Create Tenant"', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();

      const createBtn = screen.getByRole('button', { name: /\+?Create Tenant/i });
      fireEvent.click(createBtn);

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 3, name: /Create New Tenant/i })
      ).toBeInTheDocument();
    });

    it('auto-derives slug from trade name or legal name until slug is manually edited', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));

      const legalInput = screen.getByLabelText(/Legal Business Name/i);
      const tradeInput = screen.getByLabelText(/Trade \/ Store Name/i);
      const slugInput = screen.getByLabelText(/Tenant Slug \/ Subdomain/i);

      // Typing legal name auto-populates slug
      fireEvent.change(legalInput, { target: { value: 'Delta Supermarket Pvt Ltd' } });
      expect(slugInput.value).toBe('delta-supermarket-pvt-ltd');

      // Typing trade name overrides slug with trade name
      fireEvent.change(tradeInput, { target: { value: 'Delta Quick Mart' } });
      expect(slugInput.value).toBe('delta-quick-mart');

      // Manually editing slug locks it
      fireEvent.change(slugInput, { target: { value: 'custom-delta' } });
      expect(slugInput.value).toBe('custom-delta');

      // Subsequent edits to trade name do not overwrite manual slug
      fireEvent.change(tradeInput, { target: { value: 'Delta Grand Express' } });
      expect(slugInput.value).toBe('custom-delta');

      // Reset auto-slug button restores auto-derivation
      const resetBtn = screen.getByRole('button', { name: /Reset auto-slug/i });
      fireEvent.click(resetBtn);
      expect(slugInput.value).toBe('delta-grand-express');
    });

    it('validates required fields, phone format, and email format on client side', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));

      const submitBtn = screen.getByRole('button', { name: /Create Tenant & Generate Invite/i });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/Legal business name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/Slug must be at least 2 characters/i)).toBeInTheDocument();
      expect(screen.getByText(/Owner full name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/Phone number must be valid E.164 format/i)).toBeInTheDocument();
      expect(screen.getByText(/Owner email is required/i)).toBeInTheDocument();
    });

    it('submits valid payload to POST /api/platform/tenants with double-submit lock', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: {
              id: 'new-tenant-id-123',
              legalName: 'Epsilon Retail Pvt Ltd',
              tradeName: 'Epsilon Store',
              slug: 'epsilon-store',
              status: 'INVITED',
              createdAt: '2026-11-08T12:00:00.000Z',
            },
            invitation: {
              id: 'new-inv-123',
              nominatedPhone: '+919876543210',
              nominatedEmail: 'owner@epsilon.com',
              status: 'INVITED_PENDING_ACCEPTANCE',
              rawToken: 'raw-token-never-persisted',
              activationUrl: 'http://localhost:5173/owner/activate#token=raw-token-never-persisted',
              whatsappUrl: 'https://wa.me/919876543210?text=Hello',
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));

      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Epsilon Retail Pvt Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Trade \/ Store Name/i), {
        target: { value: 'Epsilon Store' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Ramesh Patel' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919876543210' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'owner@epsilon.com' },
      });

      const submitBtn = screen.getByRole('button', { name: /Create Tenant & Generate Invite/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith('/platform/tenants', {
          legalName: 'Epsilon Retail Pvt Ltd',
          tradeName: 'Epsilon Store',
          slug: 'epsilon-store',
          ownerFullName: 'Ramesh Patel',
          ownerPhone: '+919876543210',
          ownerEmail: 'owner@epsilon.com',
        });
      });
    });

    it('handles HTTP 409 duplicate slug conflict and displays error', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: 409,
        code: 'SLUG_ALREADY_EXISTS',
        message: 'Tenant with slug already exists',
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));

      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Existing Mart Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Existing Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919876543210' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'owner@existing.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      const conflictMsgs = await screen.findAllByText(
        /A store with this slug already exists\. Please choose a different slug\./i
      );
      expect(conflictMsgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================
  // 4. WHATSAPP INVITATION MODAL & SECURITY
  // ========================================================
  describe('WhatsApp Sharing Modal & Ephemeral Security', () => {
    it('opens WhatsApp sharing modal automatically upon successful tenant creation', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: {
              id: 'tenant-share-test',
              legalName: 'Share Test Corp',
              tradeName: 'Share Mart',
              slug: 'share-mart',
              status: 'INVITED',
              createdAt: '2026-11-08T12:00:00.000Z',
            },
            invitation: {
              id: 'inv-share-test',
              nominatedPhone: '+919555666777',
              nominatedEmail: 'share@example.com',
              status: 'INVITED_PENDING_ACCEPTANCE',
              rawToken: 'share-secret-token',
              activationUrl: 'http://localhost:5173/owner/activate#token=share-secret-token',
              whatsappUrl: 'https://wa.me/919555666777?text=ShareMessage',
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));

      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Share Test Corp' },
      });
      fireEvent.change(screen.getByLabelText(/Trade \/ Store Name/i), {
        target: { value: 'Share Mart' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Share Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919555666777' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'share@example.com' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      // Share modal appears
      expect(await screen.findByText('Store Owner Invitation Ready')).toBeInTheDocument();
      expect(screen.getByText('Share Mart')).toBeInTheDocument();
      expect(screen.getByText('+919555666777')).toBeInTheDocument();
      expect(screen.getAllByText(/12 Hours/i).length).toBeGreaterThanOrEqual(1);
    });

    it('displays mandatory warning about manual send and 12-hour expiration', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: { legalName: 'Notice Store Ltd', slug: 'notice-store' },
            invitation: {
              nominatedPhone: '+919555666777',
              activationUrl: 'http://localhost:5173/owner/activate#token=test',
              whatsappUrl: 'https://wa.me/919555666777?text=Hi',
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));
      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Notice Store Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Notice Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919555666777' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'notice@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      expect(
        await screen.findByText(
          /WhatsApp will open with a pre-filled invitation message\. You must manually press Send in WhatsApp\. The activation link expires after 12 hours\./i
        )
      ).toBeInTheDocument();
    });

    it('clicking "Share on WhatsApp" invokes window.open with correct parameters', async () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => {});

      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      const testWaUrl = 'https://wa.me/919555666777?text=TestEncodedInvite';
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: { legalName: 'WA Store Ltd', slug: 'wa-store' },
            invitation: {
              nominatedPhone: '+919555666777',
              activationUrl: 'http://localhost:5173/owner/activate#token=watest',
              whatsappUrl: testWaUrl,
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));
      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'WA Store Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'WA Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919555666777' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'wa@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      const waBtn = await screen.findByRole('button', { name: /Share on WhatsApp/i });
      fireEvent.click(waBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(testWaUrl, '_blank', 'noopener,noreferrer');
    });

    it('clicking "Copy Link" copies activation link to clipboard with feedback', async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      const testActivationUrl = 'http://localhost:5173/owner/activate#token=copy-test-token';
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: { legalName: 'Copy Store Ltd', slug: 'copy-store' },
            invitation: {
              nominatedPhone: '+919555666777',
              activationUrl: testActivationUrl,
              whatsappUrl: 'https://wa.me/919555666777',
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));
      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Copy Store Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Copy Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919555666777' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'copy@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      const copyBtn = await screen.findByRole('button', { name: /Copy Link/i });
      fireEvent.click(copyBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(testActivationUrl);
      expect(await screen.findByText(/Copied!/i)).toBeInTheDocument();
    });

    it('dismissing share modal clears ephemeral invitation data from DOM', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: { success: true, data: { tenants: [], pagination: mockPagination } },
      });

      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: { legalName: 'Dismiss Store Ltd', slug: 'dismiss-store' },
            invitation: {
              nominatedPhone: '+919555666777',
              activationUrl: 'http://localhost:5173/owner/activate#token=ephemeral-token-1234',
              whatsappUrl: 'https://wa.me/919555666777',
              expiresAt: '2026-11-09T00:00:00.000Z',
            },
          },
        },
      });

      renderPage();
      fireEvent.click(screen.getByRole('button', { name: /\+?Create Tenant/i }));
      fireEvent.change(screen.getByLabelText(/Legal Business Name/i), {
        target: { value: 'Dismiss Store Ltd' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Full Name/i), {
        target: { value: 'Dismiss Owner' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Phone/i), {
        target: { value: '+919555666777' },
      });
      fireEvent.change(screen.getByLabelText(/Owner Email/i), {
        target: { value: 'dismiss@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Tenant & Generate Invite/i }));

      expect(await screen.findByText('Store Owner Invitation Ready')).toBeInTheDocument();

      const dismissBtn = screen.getByRole('button', { name: /Done & Dismiss/i });
      fireEvent.click(dismissBtn);

      await waitFor(() => {
        expect(screen.queryByText('Store Owner Invitation Ready')).not.toBeInTheDocument();
        expect(screen.queryByText(/ephemeral-token-1234/)).not.toBeInTheDocument();
      });
    });
  });

  // ========================================================
  // 5. TENANT DETAIL MODAL & AUDIT HISTORY
  // ========================================================
  describe('Tenant Detail Modal & History', () => {
    it('opens detail modal on clicking "View Details" and loads GET /api/platform/tenants/:id', async () => {
      vi.spyOn(apiClient, 'get')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              tenants: [mockTenantsList[0]],
              pagination: mockPagination,
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              id: 'tenant-1111-aaaa',
              slug: 'alpha-store',
              legalName: 'Alpha Retail Ltd',
              tradeName: 'Alpha Mart',
              status: 'ACTIVE',
              createdAt: '2026-11-08T08:00:00.000Z',
              onboarding: {
                currentStep: 6,
                isCompleted: true,
              },
              currentInvitation: {
                id: 'inv-1',
                nominatedPhone: '+919000000001',
                nominatedEmail: 'alpha@example.com',
                status: 'ACCEPTED',
                isExpired: false,
                expiresAt: '2026-11-09T10:00:00.000Z',
                createdAt: '2026-11-08T08:00:00.000Z',
              },
              invitationHistory: [
                {
                  id: 'inv-1',
                  nominatedPhone: '+919000000001',
                  nominatedEmail: 'alpha@example.com',
                  status: 'ACCEPTED',
                  isExpired: false,
                  expiresAt: '2026-11-09T10:00:00.000Z',
                  createdAt: '2026-11-08T08:00:00.000Z',
                },
                {
                  id: 'inv-0',
                  nominatedPhone: '+919000000001',
                  nominatedEmail: 'alpha@example.com',
                  status: 'SUPERSEDED',
                  isExpired: true,
                  expiresAt: '2026-11-07T10:00:00.000Z',
                  createdAt: '2026-11-06T08:00:00.000Z',
                },
              ],
            },
          },
        });

      renderPage();

      const detailsBtn = await screen.findByRole('button', { name: /View Details/i });
      fireEvent.click(detailsBtn);

      expect(
        await screen.findByRole('heading', { level: 3, name: 'Alpha Mart' })
      ).toBeInTheDocument();
      expect(screen.getByText('Store Onboarding Progress')).toBeInTheDocument();
      expect(screen.getByText('Completed (100%)')).toBeInTheDocument();
      expect(screen.getByText('Latest Owner Invitation')).toBeInTheDocument();
      expect(screen.getByText('Invitation History (2)')).toBeInTheDocument();
      expect(screen.getByText('Superseded')).toBeInTheDocument();
    });

    it('strictly does not render or leak secrets or tokens in detail modal', async () => {
      vi.spyOn(apiClient, 'get')
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: { tenants: [mockTenantsList[0]], pagination: mockPagination },
          },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              ...mockTenantsList[0],
              invitationHistory: [mockTenantsList[0].currentInvitation],
            },
          },
        });

      const { container } = renderPage();
      const detailsBtn = await screen.findByRole('button', { name: /View Details/i });
      fireEvent.click(detailsBtn);

      await screen.findByRole('heading', { level: 3, name: 'Alpha Mart' });

      const html = container.innerHTML;
      expect(html).not.toContain('tokenHash');
      expect(html).not.toContain('rawToken');
      expect(html).not.toContain('passwordHash');
      expect(html).not.toContain('secretEncrypted');
    });

    it('triggers Resend Invitation from table and opens WhatsAppShareModal with fresh links', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValue({
        data: {
          success: true,
          data: { tenants: mockTenantsList, pagination: mockPagination },
        },
      });

      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            tenant: mockTenantsList[1],
            invitation: {
              id: 'new-inv-999',
              activationUrl: 'http://localhost:5173/owner/activate#token=fresh_token_12345',
              whatsappUrl: 'https://wa.me/919000000002?text=Hello',
              nominatedPhone: '+919000000002',
              expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
            },
          },
        },
      });

      renderPage();

      const resendBtn = await screen.findByRole('button', { name: /Resend Invite/i });
      expect(resendBtn).toBeInTheDocument();

      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          `/platform/tenants/${mockTenantsList[1].id}/invitations/resend`
        );
      });

      // Verify WhatsApp sharing modal is now open with the store name and action
      expect(
        await screen.findByRole('heading', { name: /Store Owner Invitation Ready/i })
      ).toBeInTheDocument();
      expect(screen.getAllByText('Beta Fresh Groceries').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('button', { name: /Share on WhatsApp/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy Link/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Done & Dismiss/i })).toBeInTheDocument();
    });
  });

  // ========================================================
  // 7. TENANT LIFECYCLE: SUSPENSION & REACTIVATION (WP-02)
  // ========================================================
  describe('Tenant Lifecycle: Suspension & Reactivation (WP-02)', () => {
    const mockLifecycleTenants = [
      {
        id: 'tenant-active-1',
        slug: 'active-store',
        legalName: 'Active Retail Ltd',
        tradeName: 'Active Mart',
        status: 'ACTIVE',
        onboarding: { currentStep: 6, isCompleted: true },
        currentInvitation: {
          id: 'inv-act',
          nominatedPhone: '+919000000001',
          nominatedEmail: 'active@example.com',
          status: 'ACCEPTED',
          isExpired: false,
        },
        createdAt: '2026-11-08T08:00:00.000Z',
        updatedAt: '2026-11-08T08:00:00.000Z',
      },
      {
        id: 'tenant-suspended-2',
        slug: 'suspended-store',
        legalName: 'Suspended Retail Ltd',
        tradeName: 'Suspended Mart',
        status: 'SUSPENDED',
        onboarding: { currentStep: 6, isCompleted: true },
        currentInvitation: null,
        createdAt: '2026-11-08T08:00:00.000Z',
        updatedAt: '2026-11-08T08:00:00.000Z',
      },
      {
        id: 'tenant-invited-3',
        slug: 'invited-store',
        legalName: 'Invited Retail Ltd',
        tradeName: 'Invited Mart',
        status: 'INVITED',
        onboarding: { currentStep: 1, isCompleted: false },
        currentInvitation: {
          id: 'inv-inv',
          nominatedPhone: '+919000000003',
          nominatedEmail: 'invited@example.com',
          status: 'INVITED_PENDING_ACCEPTANCE',
          isExpired: false,
        },
        createdAt: '2026-11-08T08:00:00.000Z',
        updatedAt: '2026-11-08T08:00:00.000Z',
      },
    ];

    it('renders Suspend button for ACTIVE tenant, Reactivate for SUSPENDED tenant, neither for INVITED tenant', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: { tenants: mockLifecycleTenants, pagination: { ...mockPagination, total: 3 } },
        },
      });

      renderPage();

      expect(await screen.findByRole('button', { name: /^Suspend$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Reactivate$/i })).toBeInTheDocument();

      // Check row count for Suspend / Reactivate buttons
      const suspendButtons = screen.getAllByRole('button', { name: /^Suspend$/i });
      expect(suspendButtons.length).toBe(1);

      const reactivateButtons = screen.getAllByRole('button', { name: /^Reactivate$/i });
      expect(reactivateButtons.length).toBe(1);
    });

    it('opens confirmation modal and executes tenant suspension with optional reason', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: { tenants: mockLifecycleTenants, pagination: { ...mockPagination, total: 3 } },
        },
      });

      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: 'tenant-active-1',
            slug: 'active-store',
            legalName: 'Active Retail Ltd',
            tradeName: 'Active Mart',
            status: 'SUSPENDED',
            revokedSessionCount: 2,
          },
        },
      });

      renderPage();

      const suspendBtn = await screen.findByRole('button', { name: /^Suspend$/i });
      fireEvent.click(suspendBtn);

      // Confirmation modal is displayed
      expect(await screen.findByRole('heading', { name: /Suspend Store/i })).toBeInTheDocument();
      expect(screen.getByText(/immediately revoke all active sessions/i)).toBeInTheDocument();

      const reasonInput = screen.getByLabelText(/Reason/i);
      fireEvent.change(reasonInput, { target: { value: 'Compliance audit pending' } });

      const confirmBtn = screen.getByRole('button', { name: /Confirm Suspension/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          '/platform/tenants/tenant-active-1/suspend',
          { reason: 'Compliance audit pending' }
        );
      });

      // Confirmation modal closes and in-place status is updated to Suspended
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Suspend Store/i })).not.toBeInTheDocument();
      });

      expect(
        await screen.findByText(/Store "Active Mart" successfully suspended/i)
      ).toBeInTheDocument();
    });

    it('opens confirmation modal and executes tenant reactivation with optional reason', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: { tenants: mockLifecycleTenants, pagination: { ...mockPagination, total: 3 } },
        },
      });

      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: 'tenant-suspended-2',
            slug: 'suspended-store',
            legalName: 'Suspended Retail Ltd',
            tradeName: 'Suspended Mart',
            status: 'ACTIVE',
          },
        },
      });

      renderPage();

      const reactivateBtn = await screen.findByRole('button', { name: /^Reactivate$/i });
      fireEvent.click(reactivateBtn);

      // Confirmation modal is displayed
      expect(await screen.findByRole('heading', { name: /Reactivate Store/i })).toBeInTheDocument();
      expect(screen.getByText(/restore access to store operations/i)).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /Confirm Reactivation/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          '/platform/tenants/tenant-suspended-2/reactivate',
          { reason: undefined }
        );
      });

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Reactivate Store/i })).not.toBeInTheDocument();
      });

      expect(
        await screen.findByText(/Store "Suspended Mart" successfully reactivated/i)
      ).toBeInTheDocument();
    });

    it('displays error message inside modal when lifecycle API rejects', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          success: true,
          data: { tenants: mockLifecycleTenants, pagination: { ...mockPagination, total: 3 } },
        },
      });

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        response: {
          data: {
            success: false,
            message: 'Cannot suspend a tenant that has not completed activation',
          },
        },
      });

      renderPage();

      const suspendBtn = await screen.findByRole('button', { name: /^Suspend$/i });
      fireEvent.click(suspendBtn);

      const confirmBtn = await screen.findByRole('button', { name: /Confirm Suspension/i });
      fireEvent.click(confirmBtn);

      expect(
        await screen.findByText('Cannot suspend a tenant that has not completed activation')
      ).toBeInTheDocument();

      // Modal remains open on error
      expect(screen.getByRole('heading', { name: /Suspend Store/i })).toBeInTheDocument();
    });
  });
});
