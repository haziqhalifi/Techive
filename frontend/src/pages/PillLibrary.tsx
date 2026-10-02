import { CheckCircle2, FlaskConical, RefreshCw, Send, Undo2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Empty,
  ErrorPanel,
  InfoNote,
  Loading,
  PageHeader,
  PolicyBadge,
  Section,
  SgdDelta,
  Stat,
  StatusBadge,
  TierBadge,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/hooks/use-role";
import { ApiError, api } from "@/lib/harvest-api";
import { dateTimeOf, humanise, num, pct } from "@/lib/utils";
import type { EvalReport, PillDetail, PillStatus, PillSummary } from "@/types/harvest";
import { PILL_STATUSES } from "@/types/harvest";

type Failure = { message: string; details?: Record<string, unknown> };

function failureOf(cause: unknown, fallback: string): Failure {
  return {
    message: cause instanceof Error ? cause.message : fallback,
    details: cause instanceof ApiError ? cause.details : undefined,
  };
}

export default function PillLibrary() {
  const { can } = useRole();

  const [summaries, setSummaries] = useState<PillSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<PillStatus | "">("");
  const [domainFilter, setDomainFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PillDetail | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const response = await api.pills();
    setSummaries(response.pills);
    return response.pills;
  }, []);

  const loadDetail = useCallback(async (pillId: string) => {
    setDetail(await api.pill(pillId));
  }, []);

  useEffect(() => {
    let cancelled = false;

    api
      .pills()
      .then((response) => {
        if (cancelled) return;
        setSummaries(response.pills);
        setSelectedId(response.pills[0]?.pill.id ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(failureOf(cause, "Could not load the pill library."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    api
      .pill(selectedId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(failureOf(cause, "Could not load the pill."));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const domains = useMemo(
    () => [...new Set(summaries.map((summary) => summary.pill.domain))].sort(),
    [summaries],
  );

  const visible = useMemo(
    () =>
      summaries.filter(
        (summary) =>
          (statusFilter === "" || summary.version?.status === statusFilter) &&
          (domainFilter === "" || summary.pill.domain === domainFilter),
      ),
    [summaries, statusFilter, domainFilter],
  );

  /** Re-read the list and the open pill after a lifecycle transition. */
  async function refresh(openId?: string) {
    const pills = await loadList();
    const nextId = openId ?? selectedId ?? pills[0]?.pill.id ?? null;
    setSelectedId(nextId);
    if (nextId !== null) await loadDetail(nextId);
  }

  async function act(label: string, run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await run();
      await refresh();
      setStatus(`${label} succeeded.`);
      setReviewNote("");
    } catch (cause) {
      setError(failureOf(cause, `${label} failed.`));
    } finally {
      setBusy(false);
    }
  }

  const version = detail?.version ?? null;
  const canReview = can("pill:review");
  const canRollback = can("pill:rollback");
  const canCapture = can("pill:capture");

  return (
    <>
      <PageHeader
        title="Pill library"
        description="Versioned expertise with provenance. A revision stays a draft until a reviewer approves it, so editing the library can never silently change what the pipeline retrieves."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void act("Refresh", () => loadList())}
              disabled={busy}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void act("Retrieval eval", async () => {
                  setEvalReport(await api.evalReport());
                })
              }
              disabled={busy}
            >
              <FlaskConical className="h-4 w-4" aria-hidden />
              Run retrieval eval
            </Button>
          </>
        }
      />

      {error !== null && (
        <div className="mb-6">
          <ErrorPanel message={error.message} details={error.details} />
        </div>
      )}

      {status !== null && (
        <div className="mb-6 rounded-md border border-success/40 bg-success/5 px-4 py-2 text-sm text-success">
          {status}
        </div>
      )}

      {evalReport !== null && (
        <Section
          title="Retrieval eval"
          description="Precision and recall over the historical ticket set. Retrieval is deterministic — the model only ever chooses among the returned candidates."
          className="mb-6"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setEvalReport(null)}>
              Dismiss
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Cases" value={evalReport.total} />
            <Stat label="Hits" value={evalReport.hits} tone="success" />
            <Stat label="Precision" value={pct(evalReport.precision)} />
            <Stat
              label="Recall"
              value={pct(evalReport.recall)}
              tone={evalReport.recall >= 1 ? "success" : "destructive"}
            />
          </div>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Selected</TableHead>
                  <TableHead className="text-right">Hit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evalReport.results.map((result) => (
                  <TableRow key={result.caseId}>
                    <TableCell className="font-mono text-xs">{result.caseId}</TableCell>
                    <TableCell className="font-mono text-xs">{result.expectedPillId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {result.selectedPillId ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={result.hit ? "success" : "destructive"}>
                        {result.hit ? "hit" : "miss"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      {loading ? (
        <Loading label="Loading the pill library…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Section
            title="Library"
            description={`${visible.length} of ${summaries.length} pill(s)`}
            actions={
              <>
                <Select
                  aria-label="Status filter"
                  className="h-8 w-36 text-xs"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as PillStatus | "")}
                >
                  <option value="">All statuses</option>
                  {PILL_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {humanise(value)}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Domain filter"
                  className="h-8 w-36 text-xs"
                  value={domainFilter}
                  onChange={(event) => setDomainFilter(event.target.value)}
                >
                  <option value="">All domains</option>
                  {domains.map((domain) => (
                    <option key={domain} value={domain}>
                      {humanise(domain)}
                    </option>
                  ))}
                </Select>
              </>
            }
          >
            {visible.length === 0 ? (
              <Empty message="No pills match the filter." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pill</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-right">Counts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((summary) => {
                    const isOpen = summary.pill.id === selectedId;
                    return (
                      <TableRow
                        key={summary.pill.id}
                        onClick={() => setSelectedId(summary.pill.id)}
                        className={`cursor-pointer ${isOpen ? "bg-accent/60" : ""}`}
                      >
                        <TableCell>
                          <div className="font-medium">{summary.pill.title}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {summary.pill.slug}
                          </div>
                        </TableCell>
                        <TableCell>
                          {summary.version !== null ? (
                            <div className="flex items-center gap-1.5">
                              <span className="tabular text-xs">v{summary.version.version}</span>
                              <StatusBadge status={summary.version.status} />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">no version</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs text-muted-foreground">
                          {summary.claimCount} claims · {summary.optionCount} options
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Section>

          <div className="space-y-6">
            {detail === null || version === null ? (
              <Empty message="Select a pill to see its detail." />
            ) : (
              <>
                <Section
                  title={detail.pill.title}
                  description={`${detail.pill.id} · ${humanise(detail.pill.domain)} · origin ${detail.pill.originSiteId || "—"}`}
                  actions={
                    <div className="flex items-center gap-2">
                      <span className="tabular text-xs text-muted-foreground">
                        v{version.version}
                      </span>
                      <StatusBadge status={version.status} />
                      <TierBadge tier={version.actionTier} />
                    </div>
                  }
                >
                  <div className="space-y-5">
                    <p className="text-sm text-muted-foreground">{version.summary}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {version.triggers.map((trigger) => (
                        <Badge key={trigger} variant="outline">
                          {trigger}
                        </Badge>
                      ))}
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Steps
                      </h3>
                      <ol className="space-y-1.5">
                        {version.steps.map((step) => (
                          <li key={step.order} className="flex gap-2 text-sm">
                            <span className="tabular w-5 shrink-0 text-muted-foreground">
                              {step.order}.
                            </span>
                            <span>{step.instruction}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Context requirements (FR-09)
                      </h3>
                      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Asset types</dt>
                          <dd className="font-mono text-xs">
                            {version.contextRequirements.assetTypes.join(", ") || "any"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Chiller plant</dt>
                          <dd className="font-mono text-xs">
                            {version.contextRequirements.chillerPlant ?? "any"}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Tariff</dt>
                          <dd className="tabular text-xs">
                            {version.contextRequirements.tariffSgdPerKwh === null
                              ? "any"
                              : `S$${version.contextRequirements.tariffSgdPerKwh.toFixed(3)}/kWh`}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Min GFA</dt>
                          <dd className="tabular text-xs">
                            {version.contextRequirements.minGfaSqm === null
                              ? "any"
                              : `≥ ${version.contextRequirements.minGfaSqm.toLocaleString("en-SG")} m²`}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Claims and provenance (FR-02)
                      </h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Kind</TableHead>
                            <TableHead>Claim</TableHead>
                            <TableHead>Source quote</TableHead>
                            <TableHead className="text-right">Conf.</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.claims.map((claim) => {
                            const excerpt =
                              detail.excerpts.find((item) => item.id === claim.sourceExcerptId) ??
                              null;
                            return (
                              <TableRow key={claim.id}>
                                <TableCell>
                                  <Badge variant={claim.kind === "unknown" ? "warning" : "secondary"}>
                                    {humanise(claim.kind)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm">{claim.text}</TableCell>
                                <TableCell className="max-w-[22rem] text-xs text-muted-foreground">
                                  {excerpt === null ? (
                                    <span className="italic">no quote cited</span>
                                  ) : (
                                    <>
                                      <span className="font-medium">{excerpt.speaker}:</span> “
                                      {excerpt.text}”
                                    </>
                                  )}
                                </TableCell>
                                <TableCell className="tabular text-right text-xs">
                                  {num(claim.confidence)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    {detail.options.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Priced options
                        </h3>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Option</TableHead>
                              <TableHead>Policy tier</TableHead>
                              <TableHead>Tier</TableHead>
                              <TableHead className="text-right">Cost delta</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.options.map((option) => (
                              <TableRow key={option.id}>
                                <TableCell>
                                  <div className="font-medium">{option.label}</div>
                                  {option.detail !== "" && (
                                    <div className="mt-0.5 text-xs text-muted-foreground">
                                      {option.detail}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <PolicyBadge rank={option.policyRank} />
                                </TableCell>
                                <TableCell>
                                  <TierBadge tier={option.actionTier} />
                                </TableCell>
                                <TableCell className="text-right">
                                  <SgdDelta value={option.sgdDelta} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Capture transcript ({detail.excerpts.length} excerpt
                        {detail.excerpts.length === 1 ? "" : "s"})
                      </h3>
                      <ul className="space-y-2">
                        {detail.excerpts.map((excerpt) => (
                          <li key={excerpt.id} className="rounded-md border bg-muted/30 p-3">
                            <div className="text-xs font-medium">{excerpt.speaker}</div>
                            <p className="mt-1 text-sm">{excerpt.text}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Section>

                <Section
                  title="Governance"
                  description="Transitions are audited. An author may never approve their own pill (FR-03)."
                >
                  <div className="space-y-4">
                    {version.status === "draft" && canCapture && (
                      <div className="flex flex-wrap items-end gap-3">
                        <Button
                          onClick={() =>
                            void act("Submit for review", () => api.submitPill(version.id))
                          }
                          disabled={busy}
                        >
                          <Send className="h-4 w-4" aria-hidden />
                          Submit for review
                        </Button>
                        <InfoNote>
                          Submitting moves this version to <strong>in review</strong>; a reviewer
                          then approves or rejects it.
                        </InfoNote>
                      </div>
                    )}

                    {version.status === "in_review" && canReview && (
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="review-note">Review note</Label>
                          <Textarea
                            id="review-note"
                            className="mt-1"
                            rows={3}
                            placeholder="Required to reject; optional to approve."
                            value={reviewNote}
                            onChange={(event) => setReviewNote(event.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            variant="success"
                            onClick={() =>
                              void act("Approve", () => api.approvePill(version.id, reviewNote))
                            }
                            disabled={busy}
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() =>
                              void act("Reject", () => api.rejectPill(version.id, reviewNote))
                            }
                            disabled={busy || reviewNote.trim().length < 3}
                          >
                            <XCircle className="h-4 w-4" aria-hidden />
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}

                    {!canReview && version.status === "in_review" && (
                      <InfoNote>
                        Only a <strong>Pill Reviewer</strong> can approve or reject. Switch roles in
                        the header to act.
                      </InfoNote>
                    )}

                    {version.status !== "draft" && version.status !== "in_review" && (
                      <InfoNote>
                        This version is <strong>{humanise(version.status)}</strong>. Revise it from
                        the capture interview to propose a new version.
                      </InfoNote>
                    )}

                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Version history
                      </h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Version</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Author</TableHead>
                            <TableHead>Reviewer</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="text-right" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.history.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell className="tabular">v{entry.version}</TableCell>
                              <TableCell>
                                <StatusBadge status={entry.status} />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{entry.authorId}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {entry.reviewerId ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {dateTimeOf(entry.createdAt)}
                              </TableCell>
                              <TableCell className="text-right">
                                {canRollback &&
                                  entry.id !== detail.pill.currentVersionId &&
                                  (entry.status === "approved" || entry.status === "superseded") && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        void act(`Rollback to v${entry.version}`, () =>
                                          api.rollbackPill(
                                            detail.pill.id,
                                            entry.id,
                                            `Rolled back to v${entry.version}`,
                                          ),
                                        )
                                      }
                                      disabled={busy}
                                    >
                                      <Undo2 className="h-3.5 w-3.5" aria-hidden />
                                      Roll back
                                    </Button>
                                  )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {!canRollback && (
                      <InfoNote>
                        Rollback is reserved for <strong>Pill Reviewers</strong>.
                      </InfoNote>
                    )}
                  </div>
                </Section>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
