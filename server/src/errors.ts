/**
 * errors.ts — typed error classes for backend routes.
 *
 * Throw these from services; the `errorHandler` middleware in app.ts
 * converts them to structured JSON responses with the right HTTP code.
 */

import type { ApiErrorCode, ApiErrorResponse } from './types.js';

const STATUS_FOR: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  AI_PREMIUM_REQUIRED: 403,
  QUOTA_EXCEEDED: 429,
  IMAGE_TOO_LARGE: 413,
  INVALID_IMAGE: 400,
  PROVIDER_DISABLED: 503,
  PROVIDER_UNAVAILABLE: 502,
  INTERNAL: 500,
  UPSTREAM: 502,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR[code];
    this.details = details;
    this.name = 'ApiError';
  }

  toResponse(): ApiErrorResponse {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export function toResponseBody(err: unknown): { status: number; body: ApiErrorResponse } {
  if (err instanceof ApiError) {
    return { status: err.status, body: err.toResponse() };
  }
  return {
    status: 500,
    body: {
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : 'Internal error',
    },
  };
}
