import { FilePlus2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Empty, ErrorPanel, InfoNote, PageHeader, Section, StatusBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { useRole } from "@/hooks/use-role";
import { ApiError, api } from "@/lib/harvest-api";
import { humanise } from "@/lib/utils";
import type {
  ActionTier,
  AssetType,
  CapturePayload,
  ClaimKind,
  PillDetail,
  PillSummary,
} from "@/types/harvest";
import { ACTION_TIERS, ASSET_TYPES, CLAIM_KINDS } from "@/types/harvest";

type Failure = { message: string; details?: Record<string, unknown> };

interface ClaimRow {
  kind: ClaimKind;
  text: string;
  sourceQuote: string;
  confidence: string;
}

interface OptionRow {
  label: string;
  detail: string;
  actionTier: ActionTier;
  sgdDelta: string;
  policyRank: string;
  sourceQuote: string;
}

interface TranscriptRow {
  speaker: string;
  text: string;
}

interface DraftForm {
  title: string;
  domain: string;
  summary: string;
  triggersText: string;
  stepsText: string;
  actionTier: ActionTier;
  assetTypes: AssetType[];
  chillerPlant: string;
  tariff: string;
  minGfa: string;
  claims: ClaimRow[];
  options: OptionRow[];
  transcript: TranscriptRow[];
}

const POLICY_RANKS = [0, 1, 2, 3, 4];

/** Whitespace- and case-insensitive, mirroring the backend's FR-02 comparison. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const EXAMPLE: DraftForm = {
  title: "Chiller plant staging drift after actuator replacement",
  domain: "chiller_plant",
  summary:
    "Restores correct chiller staging after an actuator replacement left both machines running at part load, and re-checks condenser approach.",
  triggersText: "chiller plant efficiency drift\nboth chillers at part load\ncondenser approach high",
  stepsText:
    "Verify the lead chiller is fully loaded before staging the lag chiller.\nRestore the lead/lag rotation schedule.\nRe-check condenser approach after 24 hours.",
  actionTier: "execute_with_approval",
  assetTypes: ["chiller_plant"],
  chillerPlant: "CP-1",
  tariff: "0.28",
  minGfa: "30000",
  claims: [
    {
      kind: "measured",
      text: "Condenser approach rose 3.2 C above commissioning.",
      sourceQuote: "Condenser approach was 3.2 C higher than commissioning",
      confidence: "0.9",
    },
    {
      kind: "derived",
      text: "Running both chillers at part load lifts kW/RT.",
      sourceQuote: "both chillers were running at part load",
      confidence: "0.75",
    },
    {
      kind: "unknown",
      text: "Whether the fouling is on the water or refrigerant side.",
      sourceQuote: "",
      confidence: "",
    },
  ],
  options: [
    {
      label: "Re-sequence chiller staging",
      detail: "Restore lead/lag rotation and single-chiller base load.",
      actionTier: "execute_with_approval",
      sgdDelta: "-1285.2",
      policyRank: "3",
      sourceQuote: "both chillers were running at part load",
    },
    {
      label: "Drop chilled-water setpoint",
      detail: "Lower supply setpoint to 6.5 C to recover comfort quickly.",
      actionTier: "execute_with_approval",
      sgdDelta: "642.6",
      policyRank: "3",
      sourceQuote: "",
    },
  ],
  transcript: [
    {
      speaker: "Chief Engineer",
      text: "We saw the plant staging drift after the valve actuator was replaced, so both chillers were running at part load.",
    },
    {
      speaker: "Operator",
      text: "Condenser approach was 3.2 C higher than commissioning, which points at tube fouling.",
    },
  ],
};

function emptyForm(): DraftForm {
  return {
    title: "",
    domain: "",
    summary: "",
    triggersText: "",
    stepsText: "",
    actionTier: "recommend",
    assetTypes: [],
    chillerPlant: "",
    tariff: "",
    minGfa: "",
    claims: [{ kind: "measured", text: "", sourceQuote: "", confidence: "" }],
    options: [],
    transcript: [{ speaker: "", text: "" }],
  };
}

/** Materialise the wire payload from the form's string-heavy shape. */
function buildPayload(form: DraftForm): CapturePayload {
  return {
    title: form.title.trim(),
    domain: form.domain.trim(),
    summary: form.summary.trim(),
    triggers: lines(form.triggersText),
    steps: lines(form.stepsText),
    actionTier: form.actionTier,
    contextRequirements: {
      assetTypes: form.assetTypes,
      chillerPlant: form.chillerPlant.trim() === "" ? null : form.chillerPlant.trim(),
      tariffSgdPerKwh: form.tariff.trim() === "" ? null : Number(form.tariff),
      minGfaSqm: form.minGfa.trim() === "" ? null : Number(form.minGfa),
    },
    claims: form.claims.map((claim) => ({
      kind: claim.kind,
      text: claim.text.trim(),
      sourceQuote: claim.kind === "unknown" ? null : claim.sourceQuote.trim() || null,
      ...(claim.kind !== "unknown" && claim.confidence.trim() !== ""
        ? { confidence: Number(claim.confidence) }
        : {}),
    })),
    options:
      form.options.length === 0
        ? undefined
        : form.options.map((option) => ({
            label: option.label.trim(),
            detail: option.detail.trim(),
            actionTier: option.actionTier,
            sgdDelta: Number(option.sgdDelta || "0"),
            policyRank: Number(option.policyRank || "3"),
            sourceQuote: option.sourceQuote.trim() || null,
          })),
    transcript: form.transcript.map((line) => ({
      speaker: line.speaker.trim(),
      text: line.text.trim(),
    })),
  };
}

/**
 * FR-02, checked in the browser so the interview cannot be submitted with an unprovable claim.
 * The backend repeats the check — this is a courtesy, not the enforcement point.
 */
function problemsWith(payload: CapturePayload): string[] {
  const problems: string[] = [];
  if (payload.title.length < 3) problems.push("Title must be at least 3 characters.");
  if (payload.domain.length < 2) problems.push("Domain must be at least 2 characters.");
  if (payload.summary.length < 3) problems.push("Summary must be at least 3 characters.");
  if (payload.triggers.length === 0) problems.push("Add at least one trigger.");
  if (payload.steps.length === 0) problems.push("Add at least one step.");
  if (payload.transcript.length === 0) problems.push("Add at least one transcript line.");

  const corpus = payload.transcript.map((line) => normalise(line.text));
  payload.claims.forEach((claim, index) => {
    const where = `Claim ${index + 1}`;
    if (claim.text.length < 3) problems.push(`${where}: the claim text is too short.`);
    if (claim.kind === "unknown") return;

    if (claim.sourceQuote === null || claim.sourceQuote === "") {
      problems.push(`${where}: a '${claim.kind}' claim must cite a source quote (FR-02).`);
      return;
    }
    if (!corpus.some((line) => line.includes(normalise(claim.sourceQuote ?? "")))) {
      problems.push(`${where}: the cited quote does not appear verbatim in the transcript.`);
    }
  });

  return problems;
}

function formFromDetail(detail: PillDetail): DraftForm {
  const version = detail.version;
  const excerptText = (id: string | null): string =>
    detail.excerpts.find((excerpt) => excerpt.id === id)?.text ?? "";

  return {
    title: detail.pill.title,
    domain: detail.pill.domain,
    summary: version?.summary ?? "",
    triggersText: version?.triggers.join("\n") ?? "",
    stepsText: version?.steps.map((step) => step.instruction).join("\n") ?? "",
    actionTier: version?.actionTier ?? "recommend",
    assetTypes: version?.contextRequirements.assetTypes ?? [],
    chillerPlant: version?.contextRequirements.chillerPlant ?? "",
    tariff:
      version?.contextRequirements.tariffSgdPerKwh === null ||
      version?.contextRequirements.tariffSgdPerKwh === undefined
        ? ""
        : String(version.contextRequirements.tariffSgdPerKwh),
    minGfa:
      version?.contextRequirements.minGfaSqm === null ||
      version?.contextRequirements.minGfaSqm === undefined
        ? ""
        : String(version.contextRequirements.minGfaSqm),
    claims: detail.claims.map((claim) => ({
      kind: claim.kind,
      text: claim.text,
      sourceQuote: excerptText(claim.sourceExcerptId),
      confidence: claim.kind === "unknown" ? "" : String(claim.confidence),
    })),
    options: detail.options.map((option) => ({
      label: option.label,
      detail: option.detail,
      actionTier: option.actionTier,
      sgdDelta: String(option.sgdDelta),
      policyRank: String(option.policyRank),
      sourceQuote: excerptText(option.sourceExcerptId),
    })),
    transcript: detail.excerpts.map((excerpt) => ({
      speaker: excerpt.speaker,
      text: excerpt.text,
    })),
  };
}

export default function CaptureInterview() {
  const { can } = useRole();

  const [form, setForm] = useState<DraftForm>(EXAMPLE);
  const [pills, setPills] = useState<PillSummary[]>([]);
  const [reviseTargetId, setReviseTargetId] = useState<string>("");
  const [reviseTarget, setReviseTarget] = useState<PillDetail | null>(null);
  const [created, setCreated] = useState<PillDetail | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .pills()
      .then((response) => {
        if (!cancelled) setPills(response.pills);
      })
      .catch(() => {
        // The revise selector is optional; failing to load it must not block capture.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const payload = useMemo(() => buildPayload(form), [form]);
  const problems = useMemo(() => problemsWith(payload), [payload]);

  const patch = useCallback((changes: Partial<DraftForm>) => {
    setForm((current) => ({ ...current, ...changes }));
  }, []);

  async function loadRevision() {
    if (reviseTargetId === "") return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api.pill(reviseTargetId);
      setReviseTarget(detail);
      setForm(formFromDetail(detail));
      setCreated(null);
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : "Could not load the pill.",
        details: cause instanceof ApiError ? cause.details : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result =
        reviseTarget === null
          ? await api.capturePill(payload)
          : await api.revisePill(reviseTarget.pill.id, payload);
      setCreated(result);
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : "The capture failed.",
        details: cause instanceof ApiError ? cause.details : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const allowed = can("pill:capture");

  return (
    <>
      <PageHeader
        title="Capture interview"
        description="Turn a chief engineer's account into a versioned pill. Every claim that is not 'unknown' must cite a quote that appears verbatim in the transcript (FR-02)."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setForm(EXAMPLE)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Load example
            </Button>
            <Button variant="outline" size="sm" onClick={() => setForm(emptyForm())}>
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
              Blank form
            </Button>
          </>
        }
      />

      {error !== null && (
        <div className="mb-6">
          <ErrorPanel message={error.message} details={error.details} />
        </div>
      )}

      {!allowed && (
        <div className="mb-6">
          <InfoNote>
            Only the <strong>Chief Engineer</strong> may capture pills. You can still read this form
            and inspect the provenance rules, but the API will reject a submission from this role.
          </InfoNote>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="space-y-6">
          <Section title="Pill" description="Identity and retrieval triggers.">
            <div className="space-y-4">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  className="mt-1"
                  value={form.title}
                  onChange={(event) => patch({ title: event.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="domain">Domain</Label>
                  <Input
                    id="domain"
                    className="mt-1"
                    placeholder="chiller_plant"
                    value={form.domain}
                    onChange={(event) => patch({ domain: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="tier">Action tier (FR-07)</Label>
                  <Select
                    id="tier"
                    className="mt-1"
                    value={form.actionTier}
                    onChange={(event) => patch({ actionTier: event.target.value as ActionTier })}
                  >
                    {ACTION_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {humanise(tier)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="summary">Summary</Label>
                <Textarea
                  id="summary"
                  className="mt-1"
                  rows={3}
                  value={form.summary}
                  onChange={(event) => patch({ summary: event.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="triggers">Triggers — one per line</Label>
                  <Textarea
                    id="triggers"
                    className="mt-1"
                    rows={5}
                    value={form.triggersText}
                    onChange={(event) => patch({ triggersText: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="steps">Steps — one per line</Label>
                  <Textarea
                    id="steps"
                    className="mt-1"
                    rows={5}
                    value={form.stepsText}
                    onChange={(event) => patch({ stepsText: event.target.value })}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Context requirements (FR-09)"
            description="What must be true of a target site before this pill may run or transfer."
          >
            <div className="space-y-4">
              <div>
                <Label>Asset types</Label>
                <div className="mt-2 flex flex-wrap gap-3">
                  {ASSET_TYPES.map((type) => {
                    const checked = form.assetTypes.includes(type);
                    return (
                      <label key={type} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={checked}
                          onChange={() =>
                            patch({
                              assetTypes: checked
                                ? form.assetTypes.filter((value) => value !== type)
                                : [...form.assetTypes, type],
                            })
                          }
                        />
                        {humanise(type)}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="chiller-plant">Chiller plant</Label>
                  <Input
                    id="chiller-plant"
                    className="mt-1"
                    placeholder="CP-1"
                    value={form.chillerPlant}
                    onChange={(event) => patch({ chillerPlant: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="tariff">Tariff (SGD/kWh)</Label>
                  <Input
                    id="tariff"
                    type="number"
                    step="0.001"
                    className="mt-1"
                    value={form.tariff}
                    onChange={(event) => patch({ tariff: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="min-gfa">Min GFA (m²)</Label>
                  <Input
                    id="min-gfa"
                    type="number"
                    className="mt-1"
                    value={form.minGfa}
                    onChange={(event) => patch({ minGfa: event.target.value })}
                  />
                </div>
              </div>
              <InfoNote>
                Leave a field blank for <strong>any</strong>. A <code>null</code> requirement never
                constrains transfer.
              </InfoNote>
            </div>
          </Section>

          <Section
            title="Claims and provenance (FR-02)"
            description="Every non-unknown claim must cite a quote from the transcript below."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    claims: [
                      ...form.claims,
                      { kind: "measured", text: "", sourceQuote: "", confidence: "" },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add claim
              </Button>
            }
          >
            <div className="space-y-3">
              {form.claims.map((claim, index) => {
                const quote = claim.sourceQuote.trim();
                const cited =
                  claim.kind === "unknown" ||
                  (quote !== "" &&
                    form.transcript.some((line) => normalise(line.text).includes(normalise(quote))));
                return (
                  <div key={index} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Claim {index + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        {claim.kind === "unknown" ? (
                          <Badge variant="warning">no provenance required</Badge>
                        ) : (
                          <Badge variant={cited ? "success" : "destructive"}>
                            {cited ? "quote found" : "quote not found"}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            patch({ claims: form.claims.filter((_, at) => at !== index) })
                          }
                          disabled={form.claims.length === 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
                        <div>
                          <Label htmlFor={`claim-kind-${index}`}>Kind</Label>
                          <Select
                            id={`claim-kind-${index}`}
                            className="mt-1"
                            value={claim.kind}
                            onChange={(event) =>
                              patch({
                                claims: form.claims.map((item, at) =>
                                  at === index
                                    ? { ...item, kind: event.target.value as ClaimKind }
                                    : item,
                                ),
                              })
                            }
                          >
                            {CLAIM_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {humanise(kind)}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`claim-text-${index}`}>Claim</Label>
                          <Input
                            id={`claim-text-${index}`}
                            className="mt-1"
                            value={claim.text}
                            onChange={(event) =>
                              patch({
                                claims: form.claims.map((item, at) =>
                                  at === index ? { ...item, text: event.target.value } : item,
                                ),
                              })
                            }
                          />
                        </div>
                      </div>

                      {claim.kind !== "unknown" && (
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,120px)]">
                          <div>
                            <Label htmlFor={`claim-quote-${index}`}>Source quote (verbatim)</Label>
                            <Input
                              id={`claim-quote-${index}`}
                              className="mt-1"
                              value={claim.sourceQuote}
                              onChange={(event) =>
                                patch({
                                  claims: form.claims.map((item, at) =>
                                    at === index
                                      ? { ...item, sourceQuote: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label htmlFor={`claim-conf-${index}`}>Confidence</Label>
                            <Input
                              id={`claim-conf-${index}`}
                              type="number"
                              min="0"
                              max="1"
                              step="0.05"
                              className="mt-1"
                              value={claim.confidence}
                              onChange={(event) =>
                                patch({
                                  claims: form.claims.map((item, at) =>
                                    at === index
                                      ? { ...item, confidence: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section
            title="Priced options"
            description="Optional. When omitted, the backend derives one option per step at zero cost."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    options: [
                      ...form.options,
                      {
                        label: "",
                        detail: "",
                        actionTier: form.actionTier,
                        sgdDelta: "0",
                        policyRank: "3",
                        sourceQuote: "",
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add option
              </Button>
            }
          >
            {form.options.length === 0 ? (
              <Empty
                message="No explicit options."
                hint="Options will be derived from the steps, each at zero cost."
              />
            ) : (
              <div className="space-y-3">
                {form.options.map((option, index) => (
                  <div key={index} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Option {index + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          patch({ options: form.options.filter((_, at) => at !== index) })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`opt-label-${index}`}>Label</Label>
                          <Input
                            id={`opt-label-${index}`}
                            className="mt-1"
                            value={option.label}
                            onChange={(event) =>
                              patch({
                                options: form.options.map((item, at) =>
                                  at === index ? { ...item, label: event.target.value } : item,
                                ),
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`opt-detail-${index}`}>Detail</Label>
                          <Input
                            id={`opt-detail-${index}`}
                            className="mt-1"
                            value={option.detail}
                            onChange={(event) =>
                              patch({
                                options: form.options.map((item, at) =>
                                  at === index ? { ...item, detail: event.target.value } : item,
                                ),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <Label htmlFor={`opt-tier-${index}`}>Tier</Label>
                          <Select
                            id={`opt-tier-${index}`}
                            className="mt-1"
                            value={option.actionTier}
                            onChange={(event) =>
                              patch({
                                options: form.options.map((item, at) =>
                                  at === index
                                    ? { ...item, actionTier: event.target.value as ActionTier }
                                    : item,
                                ),
                              })
                            }
                          >
                            {ACTION_TIERS.map((tier) => (
                              <option key={tier} value={tier}>
                                {humanise(tier)}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`opt-sgd-${index}`}>Cost delta (SGD)</Label>
                          <Input
                            id={`opt-sgd-${index}`}
                            type="number"
                            step="0.1"
                            className="mt-1"
                            value={option.sgdDelta}
                            onChange={(event) =>
                              patch({
                                options: form.options.map((item, at) =>
                                  at === index ? { ...item, sgdDelta: event.target.value } : item,
                                ),
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`opt-rank-${index}`}>Policy tier</Label>
                          <Select
                            id={`opt-rank-${index}`}
                            className="mt-1"
                            value={option.policyRank}
                            onChange={(event) =>
                              patch({
                                options: form.options.map((item, at) =>
                                  at === index ? { ...item, policyRank: event.target.value } : item,
                                ),
                              })
                            }
                          >
                            {POLICY_RANKS.map((rank) => (
                              <option key={rank} value={rank}>
                                {rank}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`opt-quote-${index}`}>Source quote (optional)</Label>
                        <Input
                          id={`opt-quote-${index}`}
                          className="mt-1"
                          value={option.sourceQuote}
                          onChange={(event) =>
                            patch({
                              options: form.options.map((item, at) =>
                                at === index ? { ...item, sourceQuote: event.target.value } : item,
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Transcript"
            description="The provenance anchor. Quotes are matched against these lines."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({ transcript: [...form.transcript, { speaker: "", text: "" }] })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add line
              </Button>
            }
          >
            <div className="space-y-3">
              {form.transcript.map((line, index) => (
                <div key={index} className="flex gap-3">
                  <div className="w-40 shrink-0">
                    <Label htmlFor={`speaker-${index}`}>Speaker</Label>
                    <Input
                      id={`speaker-${index}`}
                      className="mt-1"
                      value={line.speaker}
                      onChange={(event) =>
                        patch({
                          transcript: form.transcript.map((item, at) =>
                            at === index ? { ...item, speaker: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`line-${index}`}>Quote</Label>
                    <Textarea
                      id={`line-${index}`}
                      className="mt-1"
                      rows={2}
                      value={line.text}
                      onChange={(event) =>
                        patch({
                          transcript: form.transcript.map((item, at) =>
                            at === index ? { ...item, text: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="pt-6">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        patch({ transcript: form.transcript.filter((_, at) => at !== index) })
                      }
                      disabled={form.transcript.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Submit" description="The server re-validates every rule.">
            <div className="space-y-4">
              {reviseTarget !== null && (
                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <div className="font-medium">Revising {reviseTarget.pill.title}</div>
                  <div className="mt-1 text-muted-foreground">
                    A revision creates version {(reviseTarget.version?.version ?? 0) + 1} as a
                    draft. The live version is untouched until a reviewer approves it.
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setReviseTarget(null);
                      setForm(emptyForm());
                    }}
                  >
                    Cancel revision
                  </Button>
                </div>
              )}

              {problems.length > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <div className="text-xs font-semibold text-destructive">
                    {problems.length} issue{problems.length === 1 ? "" : "s"} to resolve
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-destructive">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-md border border-success/40 bg-success/5 p-3 text-xs text-success">
                  All FR-02 checks pass. Ready to submit.
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => void submit()}
                disabled={busy || problems.length > 0 || !allowed}
              >
                <Save className="h-4 w-4" aria-hidden />
                {busy
                  ? "Saving…"
                  : reviseTarget === null
                    ? "Capture pill"
                    : `Revise as v${(reviseTarget.version?.version ?? 0) + 1}`}
              </Button>

              <div>
                <Label htmlFor="revise-target">Revise an existing pill</Label>
                <Select
                  id="revise-target"
                  className="mt-1"
                  value={reviseTargetId}
                  onChange={(event) => setReviseTargetId(event.target.value)}
                >
                  <option value="">Select a pill…</option>
                  {pills.map((summary) => (
                    <option key={summary.pill.id} value={summary.pill.id}>
                      {summary.pill.title}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => void loadRevision()}
                  disabled={busy || reviseTargetId === ""}
                >
                  Load into form
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Only the pill's owner may revise it; a different owner will get a 400.
                </p>
              </div>
            </div>
          </Section>

          {created !== null && (
            <Section
              title="Captured"
              description={`${created.pill.id} · ${created.pill.slug}`}
              actions={created.version !== null ? <StatusBadge status={created.version.status} /> : null}
            >
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">Version</span>{" "}
                  <span className="tabular">v{created.version?.version ?? "?"}</span>
                </p>
                <p>
                  <span className="font-medium">Claims</span>{" "}
                  <span className="tabular">{created.claims.length}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="font-medium">Options</span>{" "}
                  <span className="tabular">{created.options.length}</span>
                </p>
                <InfoNote>
                  The version is a <strong>draft</strong>. A Pill Reviewer must approve it before
                  the pipeline can retrieve it.
                </InfoNote>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
