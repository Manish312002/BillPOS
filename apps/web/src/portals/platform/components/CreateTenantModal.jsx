import React, { useState } from 'react';
import { apiClient } from '../../../services/api/client.js';

export function generateSlug(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Superadmin Tenant Creation Modal
 *
 * Implements ADR-002 tenant creation and Store Owner invitation generation.
 * Enforces client-side validation, auto-slug derivation, double-submission lock,
 * and handles HTTP 409 duplicate slug conflict.
 */
export function CreateTenantModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    legalName: '',
    tradeName: '',
    slug: '',
    ownerFullName: '',
    ownerPhone: '+91',
    ownerEmail: '',
  });

  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (!isOpen) return null;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setServerError(null);
    setErrors((prev) => ({ ...prev, [name]: undefined }));

    if (name === 'tradeName') {
      const updated = { ...formData, tradeName: value };
      if (!slugTouched) {
        updated.slug = generateSlug(value || formData.legalName);
      }
      setFormData(updated);
    } else if (name === 'legalName') {
      const updated = { ...formData, legalName: value };
      if (!slugTouched && !formData.tradeName) {
        updated.slug = generateSlug(value);
      }
      setFormData(updated);
    } else if (name === 'slug') {
      setSlugTouched(true);
      // Auto-sanitize typed slug characters
      const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      setFormData((prev) => ({ ...prev, slug: sanitized }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const validate = () => {
    const errs = {};

    if (!formData.legalName?.trim() || formData.legalName.trim().length < 2) {
      errs.legalName = 'Legal business name is required (min 2 characters)';
    }

    const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!formData.slug?.trim() || formData.slug.trim().length < 2) {
      errs.slug = 'Slug must be at least 2 characters';
    } else if (!slugPattern.test(formData.slug.trim())) {
      errs.slug = 'Slug must be lowercase alphanumeric with optional single hyphens';
    }

    if (!formData.ownerFullName?.trim() || formData.ownerFullName.trim().length < 2) {
      errs.ownerFullName = 'Owner full name is required (min 2 characters)';
    }

    const e164Pattern = /^\+[1-9]\d{7,14}$/;
    if (!formData.ownerPhone?.trim()) {
      errs.ownerPhone = 'Owner phone number is required';
    } else if (!e164Pattern.test(formData.ownerPhone.trim())) {
      errs.ownerPhone = 'Phone number must be valid E.164 format (e.g. +919876543210)';
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.ownerEmail?.trim()) {
      errs.ownerEmail = 'Owner email is required';
    } else if (!emailPattern.test(formData.ownerEmail.trim())) {
      errs.ownerEmail = 'Valid email address is required';
    }

    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setServerError(null);

    try {
      const payload = {
        legalName: formData.legalName.trim(),
        tradeName: formData.tradeName?.trim() || undefined,
        slug: formData.slug.trim(),
        ownerFullName: formData.ownerFullName.trim(),
        ownerPhone: formData.ownerPhone.trim(),
        ownerEmail: formData.ownerEmail.trim().toLowerCase(),
      };

      const res = await apiClient.post('/platform/tenants', payload);

      // Reset form
      setFormData({
        legalName: '',
        tradeName: '',
        slug: '',
        ownerFullName: '',
        ownerPhone: '+91',
        ownerEmail: '',
      });
      setSlugTouched(false);
      setErrors({});
      setIsSubmitting(false);

      if (onSuccess) {
        onSuccess(res.data?.data || res.data);
      }
    } catch (err) {
      setIsSubmitting(false);

      if (err.status === 409 || err.code === 'SLUG_ALREADY_EXISTS') {
        const msg = 'A store with this slug already exists. Please choose a different slug.';
        setServerError(msg);
        setErrors((prev) => ({ ...prev, slug: msg }));
      } else {
        const msg = err.message || 'Failed to create tenant. Please try again.';
        setServerError(msg);
      }
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setFormData({
      legalName: '',
      tradeName: '',
      slug: '',
      ownerFullName: '',
      ownerPhone: '+91',
      ownerEmail: '',
    });
    setSlugTouched(false);
    setErrors({});
    setServerError(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-tenant-title"
    >
      <div className="relative w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 text-slate-900 dark:text-slate-100 my-8 transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h3 id="create-tenant-title" className="text-lg font-semibold text-slate-900 dark:text-white">
              Create New Tenant
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Provision a new store and generate a single-use Store Owner invitation.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
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

        {/* Server Error Banner */}
        {serverError && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-start space-x-2"
          >
            <svg
              className="h-4 w-4 flex-shrink-0 text-rose-400 mt-0.5"
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
            <span>{serverError}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Legal Name */}
            <div>
              <label htmlFor="legalName" className="block text-xs font-medium text-slate-300 mb-1">
                Legal Business Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="legalName"
                name="legalName"
                type="text"
                placeholder="Acme Retail Private Limited"
                value={formData.legalName}
                onChange={handleInputChange}
                disabled={isSubmitting}
                className={`block w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  errors.legalName
                    ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                    : 'border-slate-800 focus:border-sky-500 focus:ring-sky-500'
                }`}
              />
              {errors.legalName && (
                <p className="mt-1 text-[11px] text-rose-400">{errors.legalName}</p>
              )}
            </div>

            {/* Trade Name */}
            <div>
              <label htmlFor="tradeName" className="block text-xs font-medium text-slate-300 mb-1">
                Trade / Store Name <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <input
                id="tradeName"
                name="tradeName"
                type="text"
                placeholder="Acme Superstore"
                value={formData.tradeName}
                onChange={handleInputChange}
                disabled={isSubmitting}
                className="block w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">Public customer-facing name</p>
            </div>
          </div>

          {/* Slug */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="slug" className="block text-xs font-medium text-slate-300">
                Tenant Slug / Subdomain <span className="text-rose-400">*</span>
              </label>
              {slugTouched && (
                <button
                  type="button"
                  onClick={() => {
                    const derived = generateSlug(formData.tradeName || formData.legalName);
                    setFormData((prev) => ({ ...prev, slug: derived }));
                    setSlugTouched(false);
                  }}
                  className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                >
                  Reset auto-slug
                </button>
              )}
            </div>
            <div className="flex rounded-lg shadow-sm">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-800 bg-slate-800/60 text-slate-400 text-xs">
                billingbuddy.com/
              </span>
              <input
                id="slug"
                name="slug"
                type="text"
                placeholder="acme-superstore"
                value={formData.slug}
                onChange={handleInputChange}
                disabled={isSubmitting}
                className={`block w-full rounded-r-lg border bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  errors.slug
                    ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                    : 'border-slate-800 focus:border-sky-500 focus:ring-sky-500'
                }`}
              />
            </div>
            {errors.slug ? (
              <p className="mt-1 text-[11px] text-rose-400">{errors.slug}</p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                Unique identifier for store routing (lowercase letters, numbers, hyphens).
              </p>
            )}
          </div>

          <div className="border-t border-slate-800/80 pt-3">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Nominated Store Owner
            </h4>

            {/* Owner Full Name */}
            <div className="mb-3">
              <label
                htmlFor="ownerFullName"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Owner Full Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="ownerFullName"
                name="ownerFullName"
                type="text"
                placeholder="Rajesh Kumar"
                value={formData.ownerFullName}
                onChange={handleInputChange}
                disabled={isSubmitting}
                className={`block w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                  errors.ownerFullName
                    ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                    : 'border-slate-800 focus:border-sky-500 focus:ring-sky-500'
                }`}
              />
              {errors.ownerFullName && (
                <p className="mt-1 text-[11px] text-rose-400">{errors.ownerFullName}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Owner Phone */}
              <div>
                <label
                  htmlFor="ownerPhone"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Owner Phone (E.164) <span className="text-rose-400">*</span>
                </label>
                <input
                  id="ownerPhone"
                  name="ownerPhone"
                  type="text"
                  placeholder="+919876543210"
                  value={formData.ownerPhone}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  className={`block w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                    errors.ownerPhone
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-800 focus:border-sky-500 focus:ring-sky-500'
                  }`}
                />
                {errors.ownerPhone ? (
                  <p className="mt-1 text-[11px] text-rose-400">{errors.ownerPhone}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Includes country code with leading +
                  </p>
                )}
              </div>

              {/* Owner Email */}
              <div>
                <label
                  htmlFor="ownerEmail"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Owner Email <span className="text-rose-400">*</span>
                </label>
                <input
                  id="ownerEmail"
                  name="ownerEmail"
                  type="email"
                  placeholder="rajesh@acme.com"
                  value={formData.ownerEmail}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                  className={`block w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 ${
                    errors.ownerEmail
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500'
                      : 'border-slate-800 focus:border-sky-500 focus:ring-sky-500'
                  }`}
                />
                {errors.ownerEmail && (
                  <p className="mt-1 text-[11px] text-rose-400">{errors.ownerEmail}</p>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="mt-6 flex items-center justify-end space-x-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ backgroundColor: 'var(--theme-primary)' }}
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-white shadow hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="animate-spin -ml-0.5 mr-2 h-3.5 w-3.5 text-white"
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
                  Creating Tenant...
                </>
              ) : (
                'Create Tenant & Generate Invite'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateTenantModal;
