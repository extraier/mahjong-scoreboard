/**
 * apiClient — thin fetch wrapper used by all /lib/*Clients.
 *
 * Responsibilities:
 *  - Resolve base URL from Vite env (VITE_API_BASE_URL)
 *  - Inject Authorization: Bearer <token> when an auth token is set
 *  - Apply a 30s timeout to every request (configurable per request)
 *  - Parse JSON or throw structured ApiError
 *  - Map network failures to ApiError { code: 'NETWORK' }
 *  - Map non-2xx responses to ApiError with the correct code (spec §6)
 *
 * Spec ref: spec §5.2 (src/lib/apiClient.ts)
 */

import type { ApiError, ApiErrorCode } from '../types/api';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ApiClientConfig {
  baseUrl: string;
  /** Bearer token getter; if returns null, no auth header is sent */
  getAuthToken?: () => string | null;
  /** Default timeout in ms; override per request */
  defaultTimeoutMs?: number;
}

let config: ApiClientConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || '',
  defaultTimeoutMs: 30_000,
};

/**
 * Update the API client config. Called once at boot from main.tsx after
 * env vars are resolved. Calling this with the same fields has no effect.
 */
export function configureApiClient(next: Partial<ApiClientConfig>): void {
  config = { ...config, ...next };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** FormData — triggers multipart/form-data, no JSON header, no auth stripping */
  formData?: FormData;
  /** Per-request timeout override in ms */
  timeoutMs?: number;
  /** Extra headers */
  headers?: Record<string, string>;
  /** Query string params */
  query?: Record<string, string | number | boolean | undefined>;
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Error mapping (spec §6)
// ---------------------------------------------------------------------------

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  401: 'AUTH_REQUIRED',
  403: 'AI_PREMIUM_REQUIRED',
  413: 'IMAGE_TOO_LARGE',
  415: 'UNSUPPORTED_IMAGE',
  422: 'IMAGE_UNCLEAR',
  429: 'AI_QUOTA_EXCEEDED',
  502: 'VISION_PROVIDER_ERROR',
};

/**
 * Build an ApiError from a fetch Response.
 * Server is expected to return { code, message, ... } JSON; we trust the
 * server's `code` field, but fall back to status-code mapping if absent.
 */
async function errorFromResponse(r: Response): Promise<ApiError> {
  let parsed: { code?: string; message?: string; meta?: Record<string, unknown> } = {};
  try {
    parsed = await r.json();
  } catch {
    // Body wasn't JSON — keep parsed as {}.
  }
  const code = (parsed.code as ApiErrorCode) || STATUS_TO_CODE[r.status] || 'INTERNAL';
  return {
    code,
    message: parsed.message || defaultMessageFor(code, r.status),
    meta: parsed.meta,
    status: r.status,
  };
}

function defaultMessageFor(code: ApiErrorCode, status: number): string {
  switch (code) {
    case 'AUTH_REQUIRED':         return '請先登入。';
    case 'AI_PREMIUM_REQUIRED':   return 'AI 識別需要升級至付費會員。';
    case 'IMAGE_TOO_LARGE':       return '相片太大，請選擇較小的檔案 (上限 8 MB)。';
    case 'UNSUPPORTED_IMAGE':     return '請使用 JPEG / PNG / WebP 格式的相片。';
    case 'IMAGE_UNCLEAR':         return '相片未能清晰識別，請重新拍攝。';
    case 'AI_QUOTA_EXCEEDED':     return '本月 AI 識別次數已用完，請下月再來。';
    case 'VISION_PROVIDER_ERROR': return 'AI 服務暫時未能回應，請稍後重試。';
    case 'NETWORK':               return '網絡連線失敗，請檢查網絡狀態。';
    case 'INTERNAL':              return `伺服器錯誤 (${status})，請稍後重試。`;
    default:                      return `請求失敗 (${status})。`;
  }
}

function errorFromException(e: unknown): ApiError {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { code: 'NETWORK', message: '請求超時，請重試。' };
  }
  return { code: 'NETWORK', message: '網絡連線失敗，請檢查網絡狀態。' };
}

// ---------------------------------------------------------------------------
// Core request method
// ---------------------------------------------------------------------------

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = { ...opts.headers };
  let body: BodyInit | undefined;

  if (opts.formData) {
    body = opts.formData;
    // Browser sets multipart boundary automatically; do NOT set Content-Type
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  const token = config.getAuthToken?.();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(controller.abort, opts.timeoutMs ?? config.defaultTimeoutMs ?? 30_000);

  try {
    const res = await fetch(url, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      credentials: 'omit',
    });
    clearTimeout(timeout);

    if (res.ok) {
      // 204 / empty body case
      if (res.status === 204) {
        return { ok: true, data: undefined as T };
      }
      const data = await res.json() as T;
      return { ok: true, data };
    }
    const error = await errorFromResponse(res);
    return { ok: false, error };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: errorFromException(e) };
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = config.baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${cleanPath}`;
  if (query) {
    const entries = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (entries.length) url += `?${entries.join('&')}`;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Dev mode flag
// ---------------------------------------------------------------------------

/** True if VITE_API_BASE_URL points at the local mock server (helps UX) */
export function isMockServerEnabled(): boolean {
  const base = config.baseUrl || '';
  return base.includes('localhost') || base.includes('127.0.0.1');
}
