import { AlertTriangle, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  Empty,
  ErrorPanel,
  GateBanner,
  HopTrace,
  InfoNote,
  Loading,
  PageHeader,
  PolicyBadge,
  Section,
  SgdDelta,
  Stat,
  TierBadge,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRole } from "@/hooks/use-role";
import { ApiError, api } from "@/lib/verdant-api";
import { dateTimeOf, humanise, num, sgd } from "@/lib/utils";
import type { Case, CaseCreatePayload, DecisionCard, MetricsResponse, Site } from "@/types/verdant";

/** The complaint the PRD is built around. */
const HERO_CASE: CaseCreatePayload = {
  siteId: "site-towerk",
  floor: 23,
  zone: "North",
  symptom: "Level 23 is too hot and stuffy at 14:40",
  description:
    "Tenant reports 26.5 C against a target of 23 C. Building-wide chiller plant efficiency has drifted from 0.62 to 0.71 kW/RT over the past two weeks.",
};

const BLANK: CaseCreatePayload = {
  siteId: "site-towerk",
  floor: 23,
  zone: "",
  symptom: "",
  description: "",
};

export default function CaseConsole() {
  const { can } = useRole();

  const [sites, setSites] = useState<Site[]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [form, setForm] = useState<CaseCreatePayload>(HERO_CASE);
  const [card, setCard] = useState<DecisionCard | null>(null);
  const [recent, setRecent] = useState<Case[]>([]);

  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; details?: Record<string, unknown> } | null>(
    null,
  );

  const loadRecent = useCallback(async () => {
    try {
      const response = await api.cases();
      setRecent([...response.cases].reverse());
    } catch {
      // The recent list is a convenience; a failure must not hide the console.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.sites(), api.metrics()])
      .then(([siteResponse, metricsResponse]) => {
        if (cancelled) return;
        setSites(siteResponse.sites);
        setMetrics(metricsResponse);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError({
            message: cause instanceof Error ? cause.message : "Could not reach the API.",
            details: cause instanceof ApiError ? cause.details : undefined,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void loadRecent();

    return () => {
      cancelled = true;
    };
  }, [loadRecent]);

  async function runCase() {
    setRunning(true);
    setError(null);
    try {
      const result = await api.createCase(form);
      setCard(result);
      await loadRecent();
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : "The case could not be run.",
        details: cause instanceof ApiError ? cause.details : undefined,
      });
    } finally {
      setRunning(false);
    }
  }

  async function openCase(caseId: string) {
    setRunning(true);
    setError(null);
    try {
      setCard(await api.caseCard(caseId));
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : "The card could not be loaded.",
        details: cause instanceof ApiError ? cause.details : undefined,
      });
    } finally {
      setRunning(false);
    }
  }

  const m = metrics?.metrics ?? null;
  const selected = card?.options.find((option) => option.selected) ?? null;

  return (
    <>
      <PageHeader
        title="Case console"
        description="Run a comfort or energy complaint through the pipeline. The red-flag gate runs first; numbers are computed from telemetry, never by a model."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setForm(HERO_CASE)}>
              Load hero case
            </Button>
            <Button
              size="sm"
              onClick={() => void runCase()}
              disabled={running || !can("case:run") || form.symptom.trim() === ""}
            >
              <Play className="h-4 w-4" aria-hidden />
              Run case
            </Button>
          </>
        }
      />

      {error !== null && (
        <div className="mb-6">
          <ErrorPanel message={error.message} details={error.details} />
        </div>
      )}

      {!can("case:run") && (
        <div className="mb-6">
          <InfoNote>
            Your role cannot run cases. Switch to <strong>Asset Operations Manager</strong>,{" "}
            <strong>Chief Engineer</strong> or <strong>Site Operator</strong> to run the pipeline.
          </InfoNote>
        </div>
      )}

      {loading ? (
        <Loading label="Loading plant telemetry…" />
      ) : (
        <>
          {m !== null && (
            <section className="mb-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat
                  label="Baseline"
                  value={`${num(m.baselineKwPerRt, 4)} kW/RT`}
                  hint="Day 1 mean"
                />
                <Stat
                  label="Current"
                  value={`${num(m.currentKwPerRt, 4)} kW/RT`}
                  hint="Day 14 mean"
                  tone="destructive"
                />
                <Stat label="Drift" value={`${num(m.driftKwPerRt, 4)} kW/RT`} tone="destructive" />
                <Stat
                  label="Excess energy"
                  value={`${m.excessKwh.toLocaleString("en-SG")} kWh`}
                  hint={`${num(m.excessKw)} kW over ${m.hours} h`}
                  tone="destructive"
                />
                <Stat
                  label="Cost"
                  value={sgd(m.excessSgd)}
                  hint={`Weather-normalised ${m.weatherNormalisedKwh.toLocaleString("en-SG")} kWh`}
                  tone="destructive"
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {metrics?.summary} Source:{" "}
                <span className="font-medium">
                  {metrics?.source === "telemetry" ? "raw telemetry" : "frozen hero inputs"}
                </span>
                .
              </p>
            </section>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <Section
              title="Complaint"
              description="Parsed deterministically — regex and enums, no model."
              actions={
                <Button variant="ghost" size="sm" onClick={() => setForm(BLANK)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Clear
                </Button>
              }
            >
              <div className="space-y-3">
                <div>
                  <Label htmlFor="site">Site</Label>
                  <Select
                    id="site"
                    className="mt-1"
                    value={form.siteId}
                    onChange={(event) => setForm({ ...form, siteId: event.target.value })}
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} — {sgd(site.tariffSgdPerKwh)}/kWh
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="floor">Floor</Label>
                    <Input
                      id="floor"
                      type="number"
                      className="mt-1"
                      value={form.floor ?? ""}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          floor: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="zone">Zone</Label>
                    <Input
                      id="zone"
                      className="mt-1"
                      value={form.zone ?? ""}
                      onChange={(event) => setForm({ ...form, zone: event.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="symptom">Symptom</Label>
                  <Input
                    id="symptom"
                    className="mt-1"
                    value={form.symptom}
                    onChange={(event) => setForm({ ...form, symptom: event.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    className="mt-1"
                    rows={5}
                    value={form.description ?? ""}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </div>

                <Button
                  className="w-full"
                  onClick={() => void runCase()}
                  disabled={running || !can("case:run") || form.symptom.trim() === ""}
                >
                  <Play className="h-4 w-4" aria-hidden />
                  {running ? "Running…" : "Run case"}
                </Button>

                <InfoNote>
                  Try a red flag (<em>“there is smoke coming from the AHU”</em>) to see the pipeline
                  stop before any pill is selected.
                </InfoNote>
              </div>
            </Section>

            <div className="space-y-6">
              {running && card === null && <Loading label="Running the pipeline…" />}

              {card === null && !running && (
                <Empty
                  message="No case has been run yet."
                  hint="Load the hero case and press Run case."
                />
              )}

              {card !== null && (
                <>
                  <Section
                    title="Decision card"
                    description={`${card.case.id} · ${card.case.siteId} · reported ${dateTimeOf(card.case.reportedAt)}`}
                    actions={<TierBadge tier={card.route ?? "recommend"} />}
                  >
                    <div className="space-y-5">
                      {card.gate !== null && <GateBanner gate={card.gate} />}

                      {card.contextCheck !== null && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Context check (FR-09)
                            </h3>
                            <Badge variant={card.contextCheck.compatible ? "success" : "destructive"}>
                              {card.contextCheck.compatible ? "compatible" : "mismatch"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Compared: {card.contextCheck.checked.join(", ")}
                          </p>
                          {card.contextCheck.mismatches.length > 0 && (
                            <Table className="mt-2">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Field</TableHead>
                                  <TableHead>Required</TableHead>
                                  <TableHead>Actual</TableHead>
                                  <TableHead>Why it blocks</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {card.contextCheck.mismatches.map((mismatch) => (
                                  <TableRow key={mismatch.field}>
                                    <TableCell className="font-mono text-xs">
                                      {mismatch.field}
                                    </TableCell>
                                    <TableCell className="tabular">{mismatch.required}</TableCell>
                                    <TableCell className="tabular">{mismatch.actual}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {mismatch.note}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      )}

                      {card.selection !== null && (
                        <div className="rounded-md border bg-muted/30 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Selected pill
                            </h3>
                            <Badge variant="outline">
                              score {card.selection.score.toFixed(2)}
                            </Badge>
                            <Badge variant={card.selection.modelAssisted ? "warning" : "secondary"}>
                              {card.selection.modelAssisted ? "model-assisted" : "deterministic"}
                            </Badge>
                          </div>
                          <p className="mt-2 font-mono text-sm">{card.selection.pillId}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {card.selection.reason}
                          </p>
                          {card.selection.candidates.length > 1 && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Candidates:{" "}
                              {card.selection.candidates
                                .map((candidate) => `${candidate.pillId} (${candidate.score})`)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                      )}

                      {card.metrics !== null && (
                        <div className="grid gap-3 sm:grid-cols-4">
                          <Stat
                            label="Drift"
                            value={`${num(card.metrics.driftKwPerRt, 4)}`}
                            hint="kW/RT"
                            tone="destructive"
                          />
                          <Stat label="Excess power" value={`${num(card.metrics.excessKw)} kW`} />
                          <Stat
                            label="Excess energy"
                            value={`${card.metrics.excessKwh.toLocaleString("en-SG")} kWh`}
                          />
                          <Stat
                            label="Cost"
                            value={sgd(card.metrics.excessSgd)}
                            hint={`at ${sgd(card.metrics.tariffSgdPerKwh)}/kWh`}
                            tone="destructive"
                          />
                        </div>
                      )}

                      {card.summary !== null && (
                        <p className="text-sm text-muted-foreground">{card.summary}</p>
                      )}

                      {card.options.length > 0 && (
                        <div>
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Priced options
                          </h3>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-8" />
                                <TableHead>Option</TableHead>
                                <TableHead>Policy tier</TableHead>
                                <TableHead>Tier</TableHead>
                                <TableHead className="text-right">Cost delta</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {card.options.map((option) => (
                                <TableRow
                                  key={option.id}
                                  className={option.selected ? "bg-success/5" : undefined}
                                >
                                  <TableCell>
                                    {option.selected ? (
                                      <Badge variant="success">selected</Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
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

                      <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
                        <div className="flex items-start gap-2">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                            aria-hidden
                          />
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Policy decision
                            </p>
                            <p className="mt-1 text-sm">{card.policyNote}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Pipeline trace ({card.hops.length} hops)
                        </h3>
                        <HopTrace hops={card.hops} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={card.auditVerified ? "success" : "destructive"}>
                          {card.auditVerified ? "audit chain verified" : "audit chain broken"}
                        </Badge>
                        <span>Case status: {humanise(card.case.status)}</span>
                        {selected !== null && <span>Selected: {selected.label}</span>}
                      </div>
                    </div>
                  </Section>
                </>
              )}

              <Section
                title="Recent cases"
                description="Newest first. Selecting one re-derives its card without writing to the audit log."
                actions={
                  <Button variant="outline" size="sm" onClick={() => void loadRecent()}>
                    Refresh
                  </Button>
                }
              >
                {recent.length === 0 ? (
                  <Empty message="No cases yet." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case</TableHead>
                        <TableHead>Site / floor</TableHead>
                        <TableHead>Symptom</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.slice(0, 12).map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-mono text-xs">{record.id}</TableCell>
                          <TableCell className="tabular">
                            {record.siteId.replace("site-", "")}
                            {record.floor !== null && ` · L${record.floor}`}
                          </TableCell>
                          <TableCell className="max-w-[24rem] truncate">{record.symptom}</TableCell>
                          <TableCell>
                            <Badge variant={record.status === "escalated" ? "destructive" : "outline"}>
                              {humanise(record.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openCase(record.id)}
                            >
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
