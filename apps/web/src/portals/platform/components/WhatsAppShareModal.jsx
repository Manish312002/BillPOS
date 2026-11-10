import React, { useState } from 'react';

/**
 * Ephemeral WhatsApp and Invitation Sharing Modal
 *
 * Security Requirements:
 * - Displays the ephemeral activation URL and WhatsApp click-to-chat URL.
 * - Displays a mandatory warning that WhatsApp opens with a pre-filled message that must be manually sent, and that the link expires after 12 hours.
 * - Copies activation link to clipboard with accessible feedback.
 * - On close, parent state wipes all invitation data (ephemeral component state only, zero local/session storage).
 */
export function WhatsAppShareModal({ isOpen, onClose, invitationData }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !invitationData) return null;

  const tenant = invitationData.tenant || (invitationData.slug ? invitationData : null);
  const invitation = invitationData.invitation || invitationData;
  const storeName = tenant?.tradeName || tenant?.legalName || 'New Store';
  const phone = invitation?.nominatedPhone || invitation?.invitedPhone || '';
  const activationUrl = invitation?.activationUrl || '';
  const whatsappUrl = invitation?.whatsappUrl || '';
  const expiresAt = invitation?.expiresAt ? new Date(invitation.expiresAt) : null;

  const handleCopyLink = async () => {
    if (!activationUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(activationUrl);
      } else {
        // Fallback for non-secure contexts
        const textarea = document.createElement('textarea');
        textarea.value = activationUrl;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // If clipboard copy fails, user can manually copy from the input
    }
  };

  const handleOpenWhatsApp = () => {
    if (!whatsappUrl) return;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 text-slate-900 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-emerald-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0a8 8 0 11-16 0 8 8 0 0116 0z"
                />
              </svg>
            </div>
            <div>
              <h3 id="share-modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                Store Owner Invitation Ready
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Created store: <span className="font-medium text-slate-800 dark:text-slate-200">{storeName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
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

        {/* Content Body */}
        <div className="mt-5 space-y-4">
          {/* Metadata Cards */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <span className="text-slate-500 dark:text-slate-400 block">Invited Owner Phone</span>
              <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 block mt-0.5">
                {phone || '—'}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
              <span className="text-slate-500 dark:text-slate-400 block">Invitation Validity</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400 block mt-0.5">
                12 Hours
                {expiresAt && (
                  <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">
                    Expires{' '}
                    {expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Activation Link */}
          <div>
            <label
              htmlFor="activation-url-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Single-Use Activation Link
            </label>
            <div className="flex rounded-lg shadow-2xs">
              <input
                id="activation-url-input"
                type="text"
                readOnly
                value={activationUrl}
                className="block w-full rounded-l-lg border border-r-0 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-300 focus:outline-none select-all"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center px-4 rounded-r-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap focus:outline-none cursor-pointer"
              >
                {copied ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center">
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
                    Copied!
                  </span>
                ) : (
                  <span className="flex items-center">
                    <svg
                      className="w-3.5 h-3.5 mr-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                      />
                    </svg>
                    Copy Link
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Mandatory WhatsApp Warning Notice */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start space-x-2.5">
            <svg
              className="h-5 w-5 flex-shrink-0 text-amber-500 dark:text-amber-400 mt-0.5"
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
            <div className="space-y-1">
              <span className="font-semibold block text-amber-800 dark:text-amber-200">Important Delivery Notice</span>
              <p className="leading-relaxed">
                WhatsApp will open with a pre-filled invitation message. You must manually press
                Send in WhatsApp. The activation link expires after 12 hours.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-3 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Done & Dismiss
          </button>
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766 0-3.18-2.587-5.771-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.173.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
            </svg>
            Share on WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

export default WhatsAppShareModal;
