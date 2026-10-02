/**
 * Pill lifecycle and governance.
 *
 * Two rules from the PRD are enforced here and nowhere else:
 *   FR-02 — a claim that is not `unknown` must cite a verbatim transcript excerpt.
 *   FR-03 — an author may never approve their own pill.
 *
 * A pill is versioned. `capturePill` creates version 1; `revisePill` creates version n+1 as a
 * draft. A revision does **not** become the live version until it is approved, so editing the
 * library can never silently change what the pipeline retrieves.
 *
 * Every transition writes an audit entry; the caller is responsible for nothing.
 */

import { appendAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS } from "@/modules/audit/audit.types";
import type { Actor } from "@/modules/governance/actor";
import { assertCan } from "@/modules/governance/roles";
import { ConflictError, NotFoundError, ValidationFailure } from "@/shared/errors";
import { db, nextId, nowIso } from "@/shared/store";
import {
  countClaims,
  countOptions,
  getPillDetail,
  getPillRecord,
  getVersion,
  listVersions,
} from "./pill.repository";
import { POLICY_TIERS } from "./pill.types";
import type {
  Claim,
  ClaimInput,
  Pill,
  PillCaptureInput,
  PillDetail,
  PillOption,
  PillOptionInput,
  PillStatus,
  PillSummary,
  PillVersion,
  TranscriptExcerpt,
} from "./pill.types";

/** Collapse whitespace and case so quotes compare reliably. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function findExcerptByQuote(
  excerpts: readonly TranscriptExcerpt[],
  quote: string,
): TranscriptExcerpt | null {
  const needle = normalise(quote);
  return excerpts.find((excerpt) => normalise(excerpt.text).includes(needle)) ?? null;
}

/**
 * FR-02 — every claim must be provable.
 *
 * When a transcript is supplied the cited quote must actually appear in it, so a claim cannot
 * cite a sentence the engineer never said.
 */
export function validateClaims(
  claims: readonly ClaimInput[],
  transcript: readonly { speaker: string; text: string }[] = [],
): void {
  if (claims.length === 0) {
    throw new ValidationFailure("A pill must carry at least one claim.");
  }

  const corpus = transcript.map((line) => normalise(line.text));

  claims.forEach((claim, index) => {
    const where = `claims[${index}]`;

    if (claim.confidence !== undefined && (claim.confidence < 0 || claim.confidence > 1)) {
      throw new ValidationFailure(`${where}: confidence must be between 0 and 1.`, { index });
    }

    if (claim.kind === "unknown") {
      if (claim.confidence !== undefined && claim.confidence > 0) {
        throw new ValidationFailure(
          `${where}: an 'unknown' claim must not assert confidence (FR-02).`,
          { index },
        );
      }
      return;
    }

    if (claim.sourceQuote === null || claim.sourceQuote.trim() === "") {
      throw new ValidationFailure(
        `${where}: a '${claim.kind}' claim must cite a source quote (FR-02).`,
        { index, kind: claim.kind },
      );
    }

    const quote = normalise(claim.sourceQuote);
    if (corpus.length > 0 && !corpus.some((line) => line.includes(quote))) {
      throw new ValidationFailure(
        `${where}: the cited quote does not appear in the capture transcript (FR-02).`,
        { index, quote: claim.sourceQuote },
      );
    }
  });
}

function assertCapturable(input: PillCaptureInput): void {
  if (input.title.trim() === "") throw new ValidationFailure("A pill needs a title.");
  if (input.triggers.length === 0) throw new ValidationFailure("A pill needs at least one trigger.");
  validateClaims(input.claims, input.transcript);
}

/** FR-03 — separation of duties. */
export function assertAuthorCannotApprove(version: PillVersion, actor: Actor): void {
  if (version.authorId === actor.id) {
    throw new ValidationFailure(
      "An author may not approve their own pill (FR-03). Route it to a different reviewer.",
      { pillVersionId: version.id, authorId: version.authorId, actorId: actor.id },
    );
  }
}

/**
 * Materialise one version's content: excerpts, the version row, its claims and its priced
 * options. Shared by capture (version 1) and revise (version n+1) so the two paths cannot
 * diverge.
 */
function buildVersionContent(
  pill: Pill,
  input: PillCaptureInput,
  actor: Actor,
  versionNumber: number,
  supersedesVersionId: string | null,
): { version: PillVersion; claims: Claim[]; options: PillOption[]; excerpts: TranscriptExcerpt[] } {
  const ts = nowIso();

  const excerpts: TranscriptExcerpt[] = input.transcript.map((line) => ({
    id: nextId("tex"),
    pillId: pill.id,
    speaker: line.speaker,
    text: line.text.trim(),
    capturedAt: ts,
    tags: [],
    embedding: null,
  }));
  db().transcriptExcerpts.push(...excerpts);

  const version: PillVersion = {
    id: nextId("pv"),
    pillId: pill.id,
    version: versionNumber,
    status: "draft",
    summary: input.summary,
    triggers: input.triggers.map((trigger) => trigger.trim()).filter(Boolean),
    actionTier: input.actionTier,
    steps: input.steps.map((instruction, index) => ({ order: index + 1, instruction })),
    claimIds: [],
    contextRequirements: input.contextRequirements,
    authorId: actor.id,
    reviewerId: null,
    reviewNote: null,
    approvedAt: null,
    supersedesVersionId,
    createdAt: ts,
  };
  db().pillVersions.push(version);

  const claims: Claim[] = input.claims.map((claim) => {
    const excerpt =
      claim.sourceQuote === null ? null : findExcerptByQuote(excerpts, claim.sourceQuote);
    return {
      id: nextId("claim"),
      pillVersionId: version.id,
      kind: claim.kind,
      text: claim.text,
      sourceExcerptId: excerpt?.id ?? null,
      confidence: claim.kind === "unknown" ? 0 : (claim.confidence ?? 0.5),
    };
  });
  db().claims.push(...claims);
  version.claimIds = claims.map((claim) => claim.id);

  const optionInputs: PillOptionInput[] =
    input.options ??
    input.steps.map((step) => ({
      label: step,
      detail: "",
      actionTier: input.actionTier,
      sgdDelta: 0,
      policyRank: POLICY_TIERS.energy_target,
      sourceQuote: null,
    }));

  const options: PillOption[] = optionInputs.map((option) => ({
    id: nextId("opt"),
    pillVersionId: version.id,
    label: option.label,
    detail: option.detail,
    actionTier: option.actionTier,
    sgdDelta: option.sgdDelta,
    policyRank: option.policyRank,
    sourceExcerptId:
      option.sourceQuote === null
        ? null
        : (findExcerptByQuote(excerpts, option.sourceQuote)?.id ?? null),
  }));
  db().pillOptions.push(...options);

  return { version, claims, options, excerpts };
}

/** Capture a brand-new pill from an interview. Creates version 1 as a draft. */
export function capturePill(input: PillCaptureInput, actor: Actor): PillDetail {
  assertCan(actor.role, "pill:capture");
  assertCapturable(input);

  const ts = nowIso();
  const pill: Pill = {
    id: nextId("pill"),
    slug: slugify(input.title),
    title: input.title.trim(),
    domain: input.domain,
    ownerId: actor.id,
    originSiteId: actor.siteId ?? "",
    currentVersionId: null,
    createdAt: ts,
  };
  db().pills.push(pill);

  const { version, claims, options, excerpts } = buildVersionContent(pill, input, actor, 1, null);
  pill.currentVersionId = version.id;

  appendAudit({
    action: AUDIT_ACTIONS.PILL_CAPTURED,
    entityType: "pill",
    entityId: pill.id,
    payload: {
      pillVersionId: version.id,
      version: version.version,
      title: pill.title,
      domain: pill.domain,
      actionTier: version.actionTier,
      triggerCount: version.triggers.length,
      claimCount: claims.length,
      optionCount: options.length,
      excerptCount: excerpts.length,
    },
    actor,
  });

  return getPillDetail(pill.id, version.id);
}

/**
 * Revise an existing pill. Creates version n+1 as a draft and leaves the live version alone —
 * a revision only takes effect once a reviewer approves it.
 */
export function revisePill(pillId: string, input: PillCaptureInput, actor: Actor): PillDetail {
  assertCan(actor.role, "pill:capture");

  const pill = getPillRecord(pillId);
  if (pill.ownerId !== actor.id) {
    throw new ValidationFailure("Only the pill's owner may revise it.", {
      pillId,
      ownerId: pill.ownerId,
      actorId: actor.id,
    });
  }

  assertCapturable(input);

  const previous = listVersions(pillId)[0] ?? null;
  const { version, claims, options } = buildVersionContent(
    pill,
    input,
    actor,
    (previous?.version ?? 0) + 1,
    previous?.id ?? null,
  );

  appendAudit({
    action: AUDIT_ACTIONS.PILL_REVISED,
    entityType: "pill",
    entityId: pill.id,
    payload: {
      pillVersionId: version.id,
      version: version.version,
      supersedesVersionId: version.supersedesVersionId,
      liveVersionId: pill.currentVersionId,
      claimCount: claims.length,
      optionCount: options.length,
    },
    actor,
  });

  return getPillDetail(pill.id, version.id);
}

/** draft → in_review. Only the author or the pill owner may submit. */
export function submitForReview(pillVersionId: string, actor: Actor): PillVersion {
  const version = getVersion(pillVersionId);
  const pill = getPillRecord(version.pillId);

  if (version.authorId !== actor.id && pill.ownerId !== actor.id) {
    throw new ValidationFailure(
      "Only the pill's author or owner may submit it for review.",
      { pillVersionId, actorId: actor.id },
    );
  }

  if (version.status !== "draft") {
    throw new ConflictError(
      `Only a 'draft' version can be submitted; this one is '${version.status}'.`,
      { pillVersionId, status: version.status },
    );
  }

  version.status = "in_review";

  appendAudit({
    action: AUDIT_ACTIONS.PILL_SUBMITTED,
    entityType: "pill",
    entityId: version.pillId,
    payload: { pillVersionId: version.id, version: version.version, authorId: version.authorId },
    actor,
  });

  return version;
}

/** in_review → approved. Supersedes the pill's previously approved version. */
export function approvePill(pillVersionId: string, actor: Actor, note = ""): PillVersion {
  assertCan(actor.role, "pill:review");

  const version = getVersion(pillVersionId);
  assertAuthorCannotApprove(version, actor);

  if (version.status !== "in_review") {
    throw new ConflictError(
      `Only an 'in_review' version can be approved; this one is '${version.status}'.`,
      { pillVersionId, status: version.status },
    );
  }

  for (const other of db().pillVersions) {
    if (other.pillId === version.pillId && other.id !== version.id && other.status === "approved") {
      other.status = "superseded";
    }
  }

  version.status = "approved";
  version.reviewerId = actor.id;
  version.reviewNote = note;
  version.approvedAt = nowIso();

  getPillRecord(version.pillId).currentVersionId = version.id;

  appendAudit({
    action: AUDIT_ACTIONS.PILL_APPROVED,
    entityType: "pill",
    entityId: version.pillId,
    payload: {
      pillVersionId: version.id,
      version: version.version,
      authorId: version.authorId,
      reviewerId: actor.id,
      note,
    },
    actor,
  });

  return version;
}

/** in_review → rejected. A reason is mandatory — rejections must teach. */
export function rejectPill(pillVersionId: string, actor: Actor, note: string): PillVersion {
  assertCan(actor.role, "pill:review");

  const version = getVersion(pillVersionId);
  if (version.status !== "in_review") {
    throw new ConflictError(
      `Only an 'in_review' version can be rejected; this one is '${version.status}'.`,
      { pillVersionId, status: version.status },
    );
  }

  if (note.trim() === "") {
    throw new ValidationFailure("A rejection must include a reason.", { pillVersionId });
  }

  version.status = "rejected";
  version.reviewerId = actor.id;
  version.reviewNote = note;

  appendAudit({
    action: AUDIT_ACTIONS.PILL_REJECTED,
    entityType: "pill",
    entityId: version.pillId,
    payload: {
      pillVersionId: version.id,
      version: version.version,
      authorId: version.authorId,
      reviewerId: actor.id,
      note,
    },
    actor,
  });

  return version;
}

/**
 * Roll the pill back to an earlier approved version. The target is re-activated and the
 * currently approved version becomes `superseded` — history is never rewritten.
 */
export function rollbackPill(
  pillId: string,
  toVersionId: string,
  actor: Actor,
  note = "",
): PillVersion {
  assertCan(actor.role, "pill:rollback");

  const pill = getPillRecord(pillId);
  const target = getVersion(toVersionId);

  if (target.pillId !== pillId) {
    throw new ValidationFailure("The rollback target does not belong to this pill.", {
      pillId,
      toVersionId,
    });
  }

  if (target.status !== "approved" && target.status !== "superseded") {
    throw new ConflictError(`Cannot roll back to a version with status '${target.status}'.`, {
      toVersionId,
      status: target.status,
    });
  }

  for (const other of db().pillVersions) {
    if (other.pillId === pillId && other.id !== target.id && other.status === "approved") {
      other.status = "superseded";
    }
  }

  target.status = "approved";
  target.approvedAt = nowIso();
  if (note.trim() !== "") target.reviewNote = note;
  pill.currentVersionId = target.id;

  appendAudit({
    action: AUDIT_ACTIONS.PILL_ROLLED_BACK,
    entityType: "pill",
    entityId: pillId,
    payload: { toVersionId: target.id, version: target.version, note },
    actor,
  });

  return target;
}

export function getPill(pillId: string): PillDetail {
  return getPillDetail(pillId);
}

/** Library listing, optionally filtered by status and/or domain. */
export function listPills(filter: { status?: PillStatus; domain?: string } = {}): PillSummary[] {
  return db()
    .pills.filter((pill) => filter.domain === undefined || pill.domain === filter.domain)
    .map((pill) => {
      const versions = listVersions(pill.id);
      const version =
        versions.find((candidate) => candidate.id === pill.currentVersionId) ?? versions[0] ?? null;
      return {
        pill,
        version,
        claimCount: version === null ? 0 : countClaims(version.id),
        optionCount: version === null ? 0 : countOptions(version.id),
      };
    })
    .filter((summary) => filter.status === undefined || summary.version?.status === filter.status)
    .sort((a, b) => (a.pill.id < b.pill.id ? -1 : a.pill.id > b.pill.id ? 1 : 0));
}

/** Used by tests and the seed to confirm a version exists before acting on it. */
export function requireVersion(pillVersionId: string): PillVersion {
  const version = db().pillVersions.find((candidate) => candidate.id === pillVersionId);
  if (!version) throw new NotFoundError("PillVersion", pillVersionId);
  return version;
}
