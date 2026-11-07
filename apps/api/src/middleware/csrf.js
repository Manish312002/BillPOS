import { env } from '../config/env.js';
import { errorResponse } from '../utils/apiResponse.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Parses allowed origins from environment configuration.
 * Strictly exact matches; wildcards and arbitrary subdomains are prohibited.
 */
function getAllowedOrigins() {
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN === '*') {
    // In local dev/test fallback, default to frontend port
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }
  return env.CORS_ORIGIN.split(',').map((o) => o.trim().toLowerCase());
}

/**
 * Extracts origin from URL safely without throwing.
 */
function extractOriginFromUrl(urlStr) {
  try {
    return new URL(urlStr).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Checks whether request carries session cookies.
 */
function hasSessionCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader || typeof cookieHeader !== 'string') return false;
  return cookieHeader.includes('bb_session=');
}

/**
 * Centralized CSRF and Origin Protection Middleware.
 * Enforces strict origin validation on state-mutating requests (POST, PUT, PATCH, DELETE)
 * that authenticate via cookies.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // If request does not authenticate via cookies (e.g. public or pure non-browser Bearer),
  // skip cookie-based CSRF checks.
  if (!hasSessionCookie(req)) {
    return next();
  }

  const allowedOrigins = getAllowedOrigins();

  // 1. Check Origin header
  const originHeader = req.headers.origin;
  if (originHeader && typeof originHeader === 'string') {
    const normalizedOrigin = originHeader.trim().toLowerCase();
    if (allowedOrigins.includes(normalizedOrigin)) {
      return next();
    }
    return res
      .status(403)
      .json(
        errorResponse(
          'Cross-origin request forbidden: Origin not allowed',
          null,
          'CSRF_ORIGIN_INVALID'
        )
      );
  }

  // 2. Check Referer header if Origin is absent
  const refererHeader = req.headers.referer;
  if (refererHeader && typeof refererHeader === 'string') {
    const refererOrigin = extractOriginFromUrl(refererHeader);
    if (refererOrigin && allowedOrigins.includes(refererOrigin)) {
      return next();
    }
    return res
      .status(403)
      .json(
        errorResponse(
          'Cross-origin request forbidden: Referer not allowed',
          null,
          'CSRF_REFERER_INVALID'
        )
      );
  }

  // 3. Both Origin and Referer are absent on a cookie-authenticated mutation
  // Check for custom header that cannot be set cross-origin without CORS preflight
  const customHeader = req.headers['x-requested-with'] || req.headers['x-csrf-protection'];
  if (customHeader) {
    return next();
  }

  return res
    .status(403)
    .json(
      errorResponse(
        'State-mutating request missing Origin, Referer, or custom CSRF verification header',
        null,
        'CSRF_HEADER_MISSING'
      )
    );
}
