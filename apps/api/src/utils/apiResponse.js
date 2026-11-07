/**
 * Standardized API Response Utilities
 */

export function successResponse(data, message = 'Success', meta = null) {
  const response = {
    success: true,
    message,
    data,
  };

  if (meta !== null) {
    response.meta = meta;
  }

  return response;
}

export function errorResponse(message = 'An error occurred', errors = null, code = 'ERROR') {
  const response = {
    success: false,
    message,
    code,
  };

  if (errors !== null) {
    response.errors = errors;
  }

  return response;
}
