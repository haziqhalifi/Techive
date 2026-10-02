import { AlertTriangle, CheckCircle2, Info, ShieldAlert, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  cn,
  formatDateTime,
  formatKwh,
  formatKwrt,
  formatPercent,
  formatSgd,
  humanise,
} from "@/lib/utils";
import type { ActionTier, CaseStatus, DecisionCard, DecisionOption, Route } from "@/types";

function TierBadge({ tier }: { tier: ActionTier }) {
  if (tier === "recommend") return <Badge variant="default">Recommend</Badge>;
  if (tier === "execute_with_approval")
    return <Badge variant="warning">Execute — needs approval</Badge>;
  return <Badge variant="destructive">Escalate</Badge>;
}

function StatusBadge({ status }: { status: CaseStatus }) {
  const variant =
    status === "resolved"
      ? "success"
      : status === "escalated"
        ? "destructive"
        : status === "blocked"
          ? "warning"
          : "default";
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}

function RouteNote({ route }: { route: Route }) {
  if (route === "escalate") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This case left the AI path. It went to a human before any model call.
        </span>
      </div>
    );
  }
  if (route === "blocked") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Transfer blocked on a context mismatch. A local reviewer must sign off before this pill is
          used here.
        </span>
      </div>
    );
  }
  if (route === "execute") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          An execute-tier action is proposed. Nothing is issued until the Asset Operations Manager
          approves — and nothing writes to the BMS.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Recommendation only. No approval is needed to read it.</span>
    </div>
  );
}

function OptionBlock({ option }: { option: DecisionOption }) {
  const saving = option.kwh_delta !== null && option.kwh_delta < 0;
  const wasting = option.kwh_delta !== null && option.kwh_delta > 0;

  return (
    <div
      className={cn(
        "rounded-md border p-4",
        option.conflict ? "border-destructive/30 bg-destructive/5" : "border-border bg-card",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TierBadge tier={option.tier} />
          <span className="font-medium">{option.label}</span>
        </div>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            saving && "text-success",
            wasting && "text-destructive",
            !saving && !wasting && "text-muted-foreground",
          )}
        >
          {formatKwh(option.kwh_delta)}
          {option.sgd_delta !== null && option.sgd_delta !== 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              {formatSgd(option.sgd_delta)}
            </span>
          )}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{option.detail}</p>

      {option.conflict && (
        <p className="mt-2 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{option.conflict}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          pill v{option.pill_version} · {option.option_id}
        </Badge>
        {option.comfort_impact && <Badge variant="muted">{option.comfort_impact}</Badge>}
        {option.renewal_flag && <Badge variant="warning">Renewal due soon</Badge>}
      </div>

      {option.source_excerpt && (
        <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
          &ldquo;{option.source_excerpt}&rdquo;
          <span className="ml-1 not-italic">— {option.source_excerpt_id}</span>
        </blockquote>
      )}
    </div>
  );
}

export function DecisionCardView({ card }: { card: DecisionCard }) {
  const metrics = card.metrics;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{card.complaint_text}</CardTitle>
            <div className="flex items-center gap-2">
              <StatusBadge status={card.status} />
              <Badge variant="outline">{humanise(card.route)}</Badge>
            </div>
          </div>
          <CardDescription>
            {card.site_id}
            {card.level !== null && ` · Level ${card.level}`}
            {card.tenant_name && ` · ${card.tenant_name}`}
            {` · reported ${formatDateTime(card.reported_at)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RouteNote route={card.route} />

          {card.gate.escalate && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Red-flag gate (FR-08)</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {card.gate.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Matched rules: {card.gate.matched_rules.join(", ") || "—"}
              </p>
            </div>
          )}

          {card.context_check && !card.context_check.compatible && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Context check (FR-09)</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {card.context_check.mismatches.map((mismatch) => (
                  <li key={mismatch}>{mismatch}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <span>
              Case <code className="font-mono">{card.case_id}</code>
            </span>
            <span>
              Pill <code className="font-mono">{card.selected_pill_id ?? "—"}</code>
              {card.pill_version !== null && ` v${card.pill_version}`}
            </span>
            <span>Selection made by: {card.generated_by}</span>
            <span className="synthetic-badge w-fit">{card.data_notice}</span>
          </div>
        </CardContent>
      </Card>

      {metrics && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <TrendingUp className="h-4 w-4" />
              <CardTitle>Plant drift, computed in code (FR-04)</CardTitle>
            </div>
            <CardDescription>{metrics.note}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Baseline" value={formatKwrt(metrics.baseline_kwrt)} />
              <Metric label="Now" value={formatKwrt(metrics.current_kwrt)} />
              <Metric
                label="Drift"
                value={`${formatKwrt(metrics.drift_kwrt)} (${formatPercent(metrics.drift_pct)})`}
                tone={metrics.exceeds_threshold ? "bad" : "good"}
              />
              <Metric label="Excess load" value={`${metrics.excess_kw.toFixed(1)} kW`} />
              <Metric label="Excess energy" value={formatKwh(metrics.excess_kwh)} />
              <Metric label="Cost of drift" value={formatSgd(metrics.excess_sgd)} />
              <Metric
                label="Weather-normalised"
                value={formatKwh(metrics.weather_normalised_excess_kwh)}
              />
              <Metric
                label="Horizon"
                value={`${metrics.horizon_hours} h @ ${metrics.load_rt} RT`}
              />
            </div>
            <Separator />
            <div className="text-xs text-muted-foreground">
              <p>
                Threshold {metrics.exceeds_threshold ? "exceeded" : "not exceeded"} ·{" "}
                {metrics.energy_price_sgd_per_kwh.toFixed(2)} SGD/kWh
                {metrics.wet_bulb_c !== null && ` · wet-bulb ${metrics.wet_bulb_c}°C`}
              </p>
              <p className="mt-1">
                These figures are produced by <code className="font-mono">services/analytics.py</code>{" "}
                and never by the language model.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Options ({card.options.length})</CardTitle>
          <CardDescription>
            Ranked safest first. Every option cites a pill version and the expert&rsquo;s own words.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {card.options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No options were produced. The case went to a human.
            </p>
          ) : (
            card.options.map((option) => <OptionBlock key={option.option_id} option={option} />)
          )}
        </CardContent>
      </Card>

      {card.policy_hierarchy && (
        <p className="text-xs text-muted-foreground">
          Policy hierarchy when rules conflict: <strong>{card.policy_hierarchy}</strong>
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}
