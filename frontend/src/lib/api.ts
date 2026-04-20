const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type EnvelopeOk<T> = { data: T; meta?: Record<string, unknown> };
type EnvelopeErr = { error: { code: string; message: string; details?: unknown } };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'include',
    ...init,
  });

  const body = (await res.json().catch(() => null)) as EnvelopeOk<T> | EnvelopeErr | null;

  if (!res.ok || !body || 'error' in body) {
    const err = body && 'error' in body ? body.error : null;
    throw new ApiError(
      res.status,
      err?.code ?? 'network_error',
      err?.message ?? `Request failed: ${res.status}`,
      err?.details,
    );
  }

  return body.data;
}
