import { errorResponse } from '../utils/apiResponse.js';

/**
 * 404 Route Not Found Middleware
 */
export function notFoundHandler(req, res) {
  res
    .status(404)
    .json(errorResponse(`Route not found: ${req.method} ${req.originalUrl}`, null, 'NOT_FOUND'));
}

export default notFoundHandler;
