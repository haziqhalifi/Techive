/**
 * Request → actor resolution.
 *
 * The demo has no password flow. The caller identifies itself with a header:
 *   x-harvest-user: user-reviewer     (preferred — names a seeded person)
 *   x-harvest-role: pill_reviewer     (switches hat to that role's seeded person)
 *
 * Falling back is deliberate and safe: with no header the first seeded user acts, so a fresh
 * `curl` against the API still works. Access control itself is never decided here — every
 * service calls `assertCan`, so an unrecognised role is still denied.
 */

import type { Request } from "express";
import { demoActor, toActor } from "@/modules/governance/actor";
import type { Actor } from "@/modules/governance/actor";
import { isRole } from "@/modules/governance/roles";
import { db } from "@/shared/store";

export const ROLE_HEADER = "x-harvest-role";
export const USER_HEADER = "x-harvest-user";

function header(req: Request, name: string): string | null {
  const raw = req.header(name);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

export function resolveActor(req: Request): Actor {
  const userId = header(req, USER_HEADER);
  if (userId !== null) {
    const user = db().users.find((candidate) => candidate.id === userId);
    if (user !== undefined) return toActor(user);
  }

  const role = header(req, ROLE_HEADER);
  if (role !== null && isRole(role)) {
    const user = db().users.find((candidate) => candidate.role === role);
    if (user !== undefined) return toActor(user);
    return demoActor(role);
  }

  const fallback = db().users[0];
  return fallback === undefined ? demoActor() : toActor(fallback);
}
