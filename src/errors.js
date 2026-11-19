export class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }

  body(requestId) {
    return {
      error: {
        code: this.code,
        message: this.message,
        request_id: requestId,
      },
    };
  }
}

export function notFound(message = 'The resource does not exist.') {
  return new ApiError(404, 'not_found', message);
}

export function unauthorized(message = 'The API key is missing or invalid.') {
  return new ApiError(401, 'invalid_api_key', message);
}

export function forbidden(message = 'This key cannot access the requested account.') {
  return new ApiError(403, 'forbidden', message);
}

export function malformed(message) {
  return new ApiError(400, 'malformed_request', message);
}

export function invalidField(message) {
  return new ApiError(422, 'validation_failed', message);
}
