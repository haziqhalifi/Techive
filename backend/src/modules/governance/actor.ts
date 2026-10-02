/**
 * Who is acting.
 *
 * The demo has no password flow — the caller names a user and the middleware resolves it.
 * That keeps the governance rules (FR-03 author ≠ approver, deny-by-default permissions)
 * observable without dragging in an identity provider.
 */

import { config } from "@/config";
import type { Role } from "./roles";

/** A person in the system, with exactly one role and an optional home site. */
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** `null` for roles that are not tied to a single building. */
  siteId: string | null;
}

/** The authenticated identity attached to a request. */
export interface Actor {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
}

export function toActor(user: User): Actor {
  return { id: user.id, name: user.name, role: user.role, siteId: user.siteId };
}

/** A synthetic actor for seeds and tests — no user record required. */
export function actorFromRole(role: Role, siteId: string | null = null, name?: string): Actor {
  return {
    id: `actor-${role}`,
    name: name ?? role,
    role,
    siteId,
  };
}

/** The fallback actor when a request carries no identity header. */
export function demoActor(role: Role = "aom"): Actor {
  return { id: config.demoUserId, name: "Demo User", role, siteId: null };
}
