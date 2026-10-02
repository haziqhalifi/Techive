/**
 * Pill lookups. Read-only — every mutation lives in `pill.service.ts` so the governance
 * rules are enforced in exactly one place.
 */

import { NotFoundError } from "@/shared/errors";
import { db } from "@/shared/store";
import type {
  Claim,
  Pill,
  PillDetail,
  PillOption,
  PillStatus,
  PillVersion,
  TranscriptExcerpt,
} from "./pill.types";

export function listPillRecords(): Pill[] {
  return [...db().pills];
}

export function getPillRecord(id: string): Pill {
  const pill = db().pills.find((candidate) => candidate.id === id);
  if (!pill) throw new NotFoundError("Pill", id);
  return pill;
}

export function findPillBySlug(slug: string): Pill | null {
  return db().pills.find((pill) => pill.slug === slug) ?? null;
}

export function listVersions(pillId: string): PillVersion[] {
  return db()
    .pillVersions.filter((version) => version.pillId === pillId)
    .sort((a, b) => b.version - a.version);
}

export function getVersion(id: string): PillVersion {
  const version = db().pillVersions.find((candidate) => candidate.id === id);
  if (!version) throw new NotFoundError("PillVersion", id);
  return version;
}

export function findVersion(id: string): PillVersion | null {
  return db().pillVersions.find((candidate) => candidate.id === id) ?? null;
}

/** The version the pill currently points at, if any. */
export function getCurrentVersion(pill: Pill): PillVersion | null {
  if (pill.currentVersionId === null) return null;
  return findVersion(pill.currentVersionId);
}

/** Every version the model is allowed to retrieve — approved only, never drafts. */
export function listApprovedVersions(domain?: string): PillVersion[] {
  const pillsById = new Map(db().pills.map((pill) => [pill.id, pill]));

  return db()
    .pillVersions.filter((version) => version.status === "approved")
    .filter(
      (version) => domain === undefined || pillsById.get(version.pillId)?.domain === domain,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function listClaims(pillVersionId: string): Claim[] {
  return db().claims.filter((claim) => claim.pillVersionId === pillVersionId);
}

export function getClaim(id: string): Claim {
  const claim = db().claims.find((candidate) => candidate.id === id);
  if (!claim) throw new NotFoundError("Claim", id);
  return claim;
}

export function listOptions(pillVersionId: string): PillOption[] {
  return db()
    .pillOptions.filter((option) => option.pillVersionId === pillVersionId)
    .sort((a, b) => a.policyRank - b.policyRank || (a.id < b.id ? -1 : 1));
}

export function listExcerpts(pillId: string): TranscriptExcerpt[] {
  return db().transcriptExcerpts.filter((excerpt) => excerpt.pillId === pillId);
}

export function getExcerpt(id: string): TranscriptExcerpt {
  const excerpt = db().transcriptExcerpts.find((candidate) => candidate.id === id);
  if (!excerpt) throw new NotFoundError("TranscriptExcerpt", id);
  return excerpt;
}

/**
 * Full detail for a pill.
 *
 * `versionId` selects a specific version (used right after a capture or revision, when the
 * caller cares about the draft they just created). Without it, the pill's *current* version is
 * returned — the one the library actually serves.
 */
export function getPillDetail(pillId: string, versionId?: string): PillDetail {
  const pill = getPillRecord(pillId);
  const history = listVersions(pillId);

  const version =
    versionId !== undefined
      ? (history.find((candidate) => candidate.id === versionId) ?? null)
      : (history.find((candidate) => candidate.id === pill.currentVersionId) ?? history[0] ?? null);

  return {
    pill,
    version,
    claims: version === null ? [] : listClaims(version.id),
    options: version === null ? [] : listOptions(version.id),
    excerpts: listExcerpts(pillId),
    history,
  };
}

/** Counts for the library list. */
export function countClaims(pillVersionId: string): number {
  return db().claims.filter((claim) => claim.pillVersionId === pillVersionId).length;
}

export function countOptions(pillVersionId: string): number {
  return db().pillOptions.filter((option) => option.pillVersionId === pillVersionId).length;
}

export function countByStatus(status: PillStatus): number {
  return db().pillVersions.filter((version) => version.status === status).length;
}
