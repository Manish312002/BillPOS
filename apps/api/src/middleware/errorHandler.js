import { ZodError } from 'zod';
import { errorResponse } from '../utils/apiResponse.js';

/**
 * Centralized Error Handling Middleware
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  if (err instanceof ZodError) {
    return res.status(400).json(
      errorResponse('Validation failed', err.issues, 'VALIDATION_ERROR')
    );
  }

  if (err.name === 'SyntaxError' && 'body' in err) {
    return res.status(400).json(
      errorResponse('Malformed JSON in request payload', null, 'BAD_REQUEST')
    );
  }

  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const message = err.message || 'Internal server error';
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR');

  if (statusCode === 500 && process.env.NODE_ENV !== 'test') {
    console.error('[Unhandled Error]', err);
  }

  return res.status(statusCode).json(
    errorResponse(
      message,
      isDev ? { stack: err.stack, details: err.details } : null,
      code
    )
  );
}

export default errorHandler;
