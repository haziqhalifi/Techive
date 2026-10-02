/**
 * Typed fetch client for the HARVEST backend.
 *
 * Server Components use API_BASE_URL; client components use NEXT_PUBLIC_API_BASE_URL.
 * The demo identity is sent as headers (X-Role / X-User-Id) because access is
 * deny-by-default on the backend — a request with no role is rejected with 403.
 */

import type {
  ApiErrorBody,
  AuditListResponse,
  CaseCreate,
  CaseListResponse,
  DecisionCard,
  HealthResponse,
  PillDetail,
  PillListResponse,
  Role,
} from "@/types";

const API_PREFIX = "/api/v1";

// Demo identity. The Asset Operations Manager is the primary demo user.
export const DEMO_ROLE: Role = "aom";
export const DEMO_REVIEWER_ROLE: Role = "pill_reviewer";
export const DEMO_USER_ID = "11111111-1111-1111-1111-111111111111";
export const DEMO_REVIEWER_ID = "33333333-3333-3333-3333-333333333333";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function apiBase(): string {
  if (typeof window === "undefined") {
    return process.env.API_BASE_URL ?? "http://localhost:8000";
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  role?: Role;
  actorId?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, role = DEMO_ROLE, actorId = DEMO_USER_ID, headers, ...rest } = options;

  const response = await fetch(`${apiBase()}${API_PREFIX}${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Role": role,
      "X-User-Id": actorId,
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let code = "request_failed";
    let message = `Request failed with status ${response.status}.`;
    let details: Record<string, unknown> = {};

    try {
      const payload = (await response.json()) as ApiErrorBody & { detail?: string };
      if (payload?.error) {
        code = payload.error.code;
        message = payload.error.message;
        details = payload.error.details ?? {};
      } else if (typeof payload?.detail === "string") {
        // FastAPI's default HTTPException shape (e.g. the deny-by-default 403).
        message = payload.detail;
        code = "forbidden";
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }

    throw new ApiRequestError(response.status, code, message, details);
  }

  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  // pills
  listPills: () => request<PillListResponse>("/pills"),
  getPill: (pillId: string) => request<PillDetail>(`/pills/${encodeURIComponent(pillId)}`),
  approvePill: (pillId: string, body: { version?: number; note: string }) =>
    request<PillDetail>(`/pills/${encodeURIComponent(pillId)}/approve`, {
      method: "POST",
      body,
      role: DEMO_REVIEWER_ROLE,
      actorId: DEMO_REVIEWER_ID,
    }),
  rejectPill: (pillId: string, body: { version?: number; note: string }) =>
    request<PillDetail>(`/pills/${encodeURIComponent(pillId)}/reject`, {
      method: "POST",
      body,
      role: DEMO_REVIEWER_ROLE,
      actorId: DEMO_REVIEWER_ID,
    }),
  rollbackPill: (pillId: string, body: { target_version: number; note: string }) =>
    request<PillDetail>(`/pills/${encodeURIComponent(pillId)}/rollback`, {
      method: "POST",
      body,
      role: DEMO_REVIEWER_ROLE,
      actorId: DEMO_REVIEWER_ID,
    }),

  // cases
  listCases: () => request<CaseListResponse>("/cases"),
  getCase: (caseId: string) => request<DecisionCard>(`/cases/${encodeURIComponent(caseId)}`),
  createCase: (body: CaseCreate, role: Role = DEMO_ROLE) =>
    request<DecisionCard>("/cases", { method: "POST", body, role }),

  // demo
  getHeroCase: () => request<CaseCreate>("/demo/hero-case"),

  // audit
  listAudit: () => request<AuditListResponse>("/audit", { role: "governance_admin" }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "forbidden") {
      return `${error.message} (the console sends X-Role headers; the backend denies by default)`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}
