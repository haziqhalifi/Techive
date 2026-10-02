import { ArrowLeftRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Empty,
  ErrorPanel,
  GateBanner,
  HopTrace,
  InfoNote,
  Loading,
  PageHeader,
  Section,
  TierBadge,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
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
import { humanise, sgd } from "@/lib/utils";
import type { DecisionCard, PillDetail, PillSummary, Site } from "@/types/harvest";

type Failure = { message: string; details?: Record<string, unknown> };

const DEFAULT_SYMPTOM = "Evaluate cross-site transfer of the selected pill";

export default function TransferCheck() {
  const { can } = useRole();

  const [sites, setSites] = useState<Site[]>([]);
  const [pills, setPills] = useState<PillSummary[]>([]);
  const [pillId, setPillId] = useState("");
  const [detail, setDetail] = useState<PillDetail | null>(null);
  const [siteId, setSiteId] = useState("");
  const [floor, setFloor] = useState("23");
  const [symptom, setSymptom] = useState(DEFAULT_SYMPTOM);
  const [card, setCard] = useState<DecisionCard | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([api.sites(), api.pills({ status: "approved" })])
      .then(([siteResponse, pillResponse]) => {
        if (cancelled) return;
        setSites(siteResponse.sites);
        setPills(pillResponse.pills);
        setPillId(pillResponse.pills[0]?.pill.id ?? "");
        setSiteId(siteResponse.sites.find((site) => site.id !== "site-towerk")?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError({
            message: cause instanceof Error ? cause.message : "Could not load reference data.",
            details: cause instanceof ApiError ? cause.details : undefined,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pillId === "") {
      setDetail(null);
      return;
    }

    let cancelled = false;
    api
      .pill(pillId)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError({
            message: cause instanceof Error ? cause.message : "Could not load the pill.",
            details: cause instanceof ApiError ? cause.details : undefined,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pillId]);

  const targetSite = useMemo(
    () => sites.find((site) => site.id === siteId) ?? null,
    [sites, siteId],
  );

  async function runTransfer() {
    if (detail === null || detail.version === null) return;
    setBusy(true);
    setError(null);
    setCard(null);
    try {
      const result = await api.createCase({
        siteId,
        floor: floor === "" ? null : Number(floor),
        symptom,
        description: `Cross-site transfer of '${detail.pill.title}' (${detail.version.id}) to ${targetSite?.name ?? siteId}.`,
        transferFromPillId: detail.version.id,
      });
      setCard(result);
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : "The transfer check failed.",
        details: cause instanceof ApiError ? cause.details : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const version = detail?.version ?? null;
  const requirements = version?.contextRequirements ?? null;
  const originSite = sites.find((site) => site.id === detail?.pill.originSiteId) ?? null;

  return (
    <>
      <PageHeader
        title="Transfer check"
        description="FR-09. Before a pill may run at another site, its context requirements are compared against that site. A mismatch blocks the transfer and no number is priced."
        actions={
          <Button
            size="sm"
            onClick={() => void runTransfer()}
            disabled={busy || !can("case:run") || version === null || siteId === ""}
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            Run transfer check
          </Button>
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
            <strong>Chief Engineer</strong> or <strong>Site Operator</strong>.
          </InfoNote>
        </div>
      )}

      {loading ? (
        <Loading label="Loading approved pills and sites…" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Section title="Transfer" description="Choose a source pill and a destination site.">
            <div className="space-y-4">
              <div>
                <Label htmlFor="pill">Source pill (approved only)</Label>
                <Select
                  id="pill"
                  className="mt-1"
                  value={pillId}
                  onChange={(event) => setPillId(event.target.value)}
                >
                  <option value="">Select a pill…</option>
                  {pills.map((summary) => (
                    <option key={summary.pill.id} value={summary.pill.id}>
                      {summary.pill.title}
                    </option>
                  ))}
                </Select>
                {pills.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No approved pills. Approve one in the pill library first.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="site">Destination site</Label>
                <Select
                  id="site"
                  className="mt-1"
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                >
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name} — {sgd(site.tariffSgdPerKwh)}/kWh ·{" "}
                      {site.gfaSqm.toLocaleString("en-SG")} m²
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
                    value={floor}
                    onChange={(event) => setFloor(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="symptom">Symptom</Label>
                  <Input
                    id="symptom"
                    className="mt-1"
                    value={symptom}
                    onChange={(event) => setSymptom(event.target.value)}
                  />
                </div>
              </div>

              <InfoNote>
                The check compares <strong>asset type</strong>, <strong>chiller plant</strong>,{" "}
                <strong>tariff</strong> and <strong>GFA</strong>. The destination site above is
                deliberately different from the pill's origin so the block is observable.
              </InfoNote>
            </div>
          </Section>

          <div className="space-y-6">
            {detail === null || version === null || requirements === null ? (
              <Empty message="Select an approved pill to see its transfer requirements." />
            ) : (
              <Section
                title="Requirements vs destination"
                description={`${detail.pill.title} · origin ${originSite?.name ?? detail.pill.originSiteId}`}
                actions={<Badge variant="outline">v{version.version}</Badge>}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Pill requires</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">asset_type</TableCell>
                      <TableCell className="font-mono text-xs">
                        {requirements.assetTypes.join(", ") || "any"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {targetSite === null ? "—" : `floor ${floor || "?"} → asset`}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        resolved on run
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">chiller_plant</TableCell>
                      <TableCell className="font-mono text-xs">
                        {requirements.chillerPlant ?? "any"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        from destination asset
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        resolved on run
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">tariff</TableCell>
                      <TableCell className="tabular text-xs">
                        {requirements.tariffSgdPerKwh === null
                          ? "any"
                          : `${requirements.tariffSgdPerKwh.toFixed(3)}`}
                      </TableCell>
                      <TableCell className="tabular text-xs">
                        {targetSite === null ? "—" : targetSite.tariffSgdPerKwh.toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right">
                        {targetSite === null || requirements.tariffSgdPerKwh === null ? (
                          <Badge variant="secondary">n/a</Badge>
                        ) : Math.abs(targetSite.tariffSgdPerKwh - requirements.tariffSgdPerKwh) >
                          0.02 ? (
                          <Badge variant="destructive">will block</Badge>
                        ) : (
                          <Badge variant="success">within 0.02</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">gfa_sqm</TableCell>
                      <TableCell className="tabular text-xs">
                        {requirements.minGfaSqm === null
                          ? "any"
                          : `≥ ${requirements.minGfaSqm.toLocaleString("en-SG")}`}
                      </TableCell>
                      <TableCell className="tabular text-xs">
                        {targetSite === null ? "—" : targetSite.gfaSqm.toLocaleString("en-SG")}
                      </TableCell>
                      <TableCell className="text-right">
                        {targetSite === null || requirements.minGfaSqm === null ? (
                          <Badge variant="secondary">n/a</Badge>
                        ) : targetSite.gfaSqm < requirements.minGfaSqm ? (
                          <Badge variant="destructive">will block</Badge>
                        ) : (
                          <Badge variant="success">ok</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">
                  The asset and chiller plant are resolved from the destination site and floor when
                  the case runs — that is why they are not shown here.
                </p>
              </Section>
            )}

            {busy && <Loading label="Running the transfer check…" />}

            {card !== null && (
              <Section
                title="Transfer result"
                description={`${card.case.id} · ${card.case.siteId} · status ${humanise(card.case.status)}`}
                actions={<TierBadge tier={card.route ?? "blocked"} />}
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
                      {card.contextCheck.mismatches.length === 0 ? (
                        <p className="mt-2 text-sm text-success">
                          Every requirement matches. The pill may run at this site.
                        </p>
                      ) : (
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

                  <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Policy decision
                    </p>
                    <p className="mt-1 text-sm">{card.policyNote}</p>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Pipeline trace ({card.hops.length} hops)
                    </h3>
                    <HopTrace hops={card.hops} />
                  </div>

                  {card.metrics !== null && (
                    <InfoNote>
                      Metrics were priced: {card.metrics.excessKwh.toLocaleString("en-SG")} kWh ·{" "}
                      {sgd(card.metrics.excessSgd)}. A blocked transfer prices nothing.
                    </InfoNote>
                  )}
                </div>
              </Section>
            )}

            {card === null && !busy && (
              <Empty
                message="No transfer check run yet."
                hint="Pick a source pill and a destination site, then run the check."
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
