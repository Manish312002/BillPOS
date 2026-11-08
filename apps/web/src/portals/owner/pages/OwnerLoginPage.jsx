import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Store Owner Login Entry Point (Deliberate Access Notice)
 * Store Owners authenticate and activate via secure WhatsApp invitation links (ADR-002).
 */
export function OwnerLoginPage() {
  return (
    <div className="min-h-screen w-full bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 text-center shadow-xl shadow-slate-950/60 space-y-5">
        {/* Solid brand emblem */}
        <div className="mx-auto h-11 w-11 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-base shadow-sm">
          BB
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] font-mono font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Store Owner Portal
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Store Owner Authentication
          </h1>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Store Owners access BillingBuddy via a secure, single-use activation link delivered to
            their nominated WhatsApp phone number by the Platform Superadmin.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400 text-left space-y-1.5">
          <div className="font-semibold text-slate-300">Activation Instructions:</div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            1. Open the WhatsApp invitation link sent by BillingBuddy.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-400">
            2. Verify the 6-digit WhatsApp OTP to claim your store.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-400">
            3. Set your store owner password to complete onboarding.
          </p>
        </div>

        <div className="pt-2">
          <Link
            to="/"
            className="block text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← Return to Portal Index
          </Link>
        </div>
      </div>
    </div>
  );
}

export default OwnerLoginPage;
