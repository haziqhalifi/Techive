/**
 * The only module that talks to the HARVEST API.
 *
 * Every request carries `x-harvest-role`, which is how the demo switches hats without a login.
 * The backend is deny-by-default, so a role without the required permission gets a 403 — the
 * console hides what a role cannot do, but never relies on that for safety.
 */

import {
  ROLES,
} from "@/types/harvest";
import type {
  Asset,
  AuditLogEntry,
  AuditVerification,
  CapturePayload,
  Case,
  CaseCreatePayload,
  CaseDetail,
  ChillerReading,
  DecisionCard,
  EvalReport,
  Health,
  MetricsResponse,
  Outcome,
  OutcomePayload,
  PillDetail,
  PillStatus,
  PillSummary,
  PillVersion,
  Role,
  RoleInfo,
  SeedStatus,
  Site,
  Tenant,
} from "@/types/harvest";

export const ROLE_STORAGE_KEY = "harvest.role";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
export const BASE_URL = (configuredBaseUrl ?? "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, details: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function readStoredRole(): Role {
  if (typeof window === "undefined") return "aom";
  const stored = window.localStorage.getItem(ROLE_STORAGE_KEY);
  return stored !== null && (ROLES as readonly string[]).includes(stored) ? (stored as Role) : "aom";
}

/**
 * The active role is module state, not React state, because it is read by the fetch wrapper at
 * request time. `RoleProvider` keeps it in sync with the UI.
 */
let currentRole: Role = readStoredRole();

export function getApiRole(): Role {
  return currentRole;
}

export function setApiRole(role: Role): void {
  currentRole = role;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-harvest-role": currentRole,
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  let body: unknown = null;
  if (raw !== "") {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }

  if (!response.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.code ?? "internal_error",
      envelope.error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
      envelope.error?.details ?? {},
    );
  }

  return body as T;
}

/** Build a query string from explicit pairs, skipping empties. */
function query(entries: [string, string | number | undefined][]): string {
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

export const api = {
  health: () => request<Health>("/api/health"),
  roles: () => request<{ roles: RoleInfo[] }>("/api/roles"),
  seedStatus: () => request<SeedStatus>("/api/seed/status"),
  reseed: () => request<Record<string, unknown>>("/api/seed", { method: "POST", body: "{}" }),

  metrics: (siteId?: string) =>
    request<MetricsResponse>(`/api/analytics/metrics${query([["siteId", siteId]])}`),
  readings: (limit = 336) =>
    request<{ count: number; total: number; readings: ChillerReading[] }>(
      `/api/analytics/readings${query([["limit", limit]])}`,
    ),

  sites: () => request<{ sites: Site[] }>("/api/sites"),
  assets: (params: { siteId?: string; assetType?: string } = {}) =>
    request<{ assets: Asset[] }>(
      `/api/assets${query([
        ["siteId", params.siteId],
        ["assetType", params.assetType],
      ])}`,
    ),
  tenants: (siteId?: string) =>
    request<{ tenants: Tenant[] }>(`/api/tenants${query([["siteId", siteId]])}`),

  pills: (params: { status?: PillStatus; domain?: string } = {}) =>
    request<{ pills: PillSummary[] }>(
      `/api/pills${query([
        ["status", params.status],
        ["domain", params.domain],
      ])}`,
    ),
  pill: (pillId: string) => request<PillDetail>(`/api/pills/${encodeURIComponent(pillId)}`),
  evalReport: () => request<EvalReport>("/api/pills/eval"),
  capturePill: (payload: CapturePayload) =>
    request<PillDetail>("/api/pills", { method: "POST", body: JSON.stringify(payload) }),
  revisePill: (pillId: string, payload: CapturePayload) =>
    request<PillDetail>(`/api/pills/${encodeURIComponent(pillId)}/revise`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submitPill: (pillVersionId: string) =>
    request<PillVersion>(`/api/pills/${encodeURIComponent(pillVersionId)}/submit`, {
      method: "POST",
      body: "{}",
    }),
  approvePill: (pillVersionId: string, note = "") =>
    request<PillVersion>(`/api/pills/${encodeURIComponent(pillVersionId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  rejectPill: (pillVersionId: string, note: string) =>
    request<PillVersion>(`/api/pills/${encodeURIComponent(pillVersionId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  rollbackPill: (pillId: string, toVersionId: string, note = "") =>
    request<PillVersion>(`/api/pills/${encodeURIComponent(pillId)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ toVersionId, note }),
    }),

  cases: (params: { siteId?: string; status?: string } = {}) =>
    request<{ cases: Case[] }>(
      `/api/cases${query([
        ["siteId", params.siteId],
        ["status", params.status],
      ])}`,
    ),
  createCase: (payload: CaseCreatePayload) =>
    request<DecisionCard>("/api/cases", { method: "POST", body: JSON.stringify(payload) }),
  caseCard: (caseId: string) =>
    request<DecisionCard>(`/api/cases/${encodeURIComponent(caseId)}`),
  caseDetail: (caseId: string) =>
    request<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/detail`),
  recordOutcome: (caseId: string, payload: OutcomePayload) =>
    request<Outcome>(`/api/cases/${encodeURIComponent(caseId)}/outcome`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  audit: (params: { entityType?: string; entityId?: string; action?: string; limit?: number } = {}) =>
    request<{ verification: AuditVerification; entries: AuditLogEntry[] }>(
      `/api/audit${query([
        ["entityType", params.entityType],
        ["entityId", params.entityId],
        ["action", params.action],
        ["limit", params.limit],
      ])}`,
    ),
  auditVerify: () => request<AuditVerification>("/api/audit/verify"),
};
