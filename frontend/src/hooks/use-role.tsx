/**
 * Role context.
 *
 * The demo has no login. The selected role is persisted to `localStorage`, pushed into the API
 * client so every request carries `x-verdant-role`, and used to hide actions the role cannot
 * perform. Hiding is a courtesy — the backend's deny-by-default `assertCan` is the real gate.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ROLE_STORAGE_KEY, api, getApiRole, setApiRole } from "@/lib/verdant-api";
import type { Role, RoleInfo } from "@/types/verdant";

interface RoleContextValue {
  role: Role;
  roles: RoleInfo[];
  /** The selected role's permission list, as reported by the server. */
  permissions: string[];
  can: (permission: string) => boolean;
  setRole: (role: Role) => void;
  loading: boolean;
  error: string | null;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => getApiRole());
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setApiRole(role);
  }, [role]);

  useEffect(() => {
    let cancelled = false;

    api
      .roles()
      .then((response) => {
        if (!cancelled) setRoles(response.roles);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load roles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setRole = useCallback((next: Role) => {
    window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    setRoleState(next);
  }, []);

  const permissions = useMemo(
    () => roles.find((entry) => entry.role === role)?.permissions ?? [],
    [roles, role],
  );

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  const value = useMemo<RoleContextValue>(
    () => ({ role, roles, permissions, can, setRole, loading, error }),
    [role, roles, permissions, can, setRole, loading, error],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleContextValue {
  const context = useContext(RoleContext);
  if (context === null) {
    throw new Error("useRole must be used inside a RoleProvider.");
  }
  return context;
}
