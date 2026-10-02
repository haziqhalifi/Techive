/**
 * Shared display pieces.
 *
 * These encode the domain's visual grammar in one place: what a route looks like, what a policy
 * tier means, what a gate trigger looks like. Pages compose them rather than re-inventing them,
 * so "rejected for breaching the energy target" looks the same everywhere it appears.
 */

import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn, humanise, TIER_LABELS } from "@/lib/utils";
import type {
  ActionTier,
  GateResult,
  Hop,
  PillStatus,
  RouteDecision,
} from "@/types/harvest";
import { POLICY_TIER_LABELS } from "@/types/harvest";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

const TONE_CLASS: Record<string, string> = {
  default: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
};

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("tabular mt-1 text-lg font-semibold", TONE_CLASS[tone])}>{value}</div>
      {hint !== undefined && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorPanel({
  message,
  details,
}: {
  message: string;
  details?: Record<string, unknown>;
}) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-destructive">{message}</p>
          {details !== undefined && Object.keys(details).length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded bg-card p-2 text-xs text-muted-foreground">
              {JSON.stringify(details, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PILL_STATUS_VARIANT: Record<PillStatus, "default" | "secondary" | "outline" | "destructive" | "success" | "warning"> = {
  draft: "outline",
  in_review: "warning",
  approved: "success",
  rejected: "destructive",
  retired: "secondary",
  superseded: "secondary",
};

export function StatusBadge({ status }: { status: PillStatus }) {
  return <Badge variant={PILL_STATUS_VARIANT[status]}>{humanise(status)}</Badge>;
}

const TIER_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive" | "success" | "warning"> = {
  recommend: "secondary",
  execute_with_approval: "default",
  escalate: "warning",
  blocked: "destructive",
};

export function TierBadge({ tier }: { tier: ActionTier | RouteDecision }) {
  return <Badge variant={TIER_VARIANT[tier] ?? "outline"}>{TIER_LABELS[tier] ?? humanise(tier)}</Badge>;
}

export function PolicyBadge({ rank }: { rank: number }) {
  return (
    <Badge variant="outline" title={`Policy tier ${rank} — lower outranks higher`}>
      {POLICY_TIER_LABELS[rank] ?? `Tier ${rank}`}
    </Badge>
  );
}

/** The safety gate's verdict. A trigger is never rendered as anything but alarming. */
export function GateBanner({ gate }: { gate: GateResult }) {
  if (!gate.triggered) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-4">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-medium text-success">Red-flag gate clear</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{gate.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive">
            Red-flag gate triggered — {humanise(gate.severity ?? "unknown")}
          </p>
          <p className="mt-1 text-sm">{gate.message}</p>
          <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <dt className="inline font-medium">Rule: </dt>
              <dd className="inline font-mono">{gate.ruleId}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Escalate to: </dt>
              <dd className="inline">{gate.escalateTo}</dd>
            </div>
            {gate.matchedText !== null && (
              <div className="sm:col-span-2">
                <dt className="inline font-medium">Matched: </dt>
                <dd className="inline font-mono">“{gate.matchedText}”</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs font-medium">
            No pill was selected and no number was computed. The pipeline stopped at the gate.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The pipeline's execution trace. Halts are marked so the early exits are legible. */
export function HopTrace({ hops }: { hops: Hop[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {hops.map((hop, index) => (
        <li key={`${hop.node}-${index}`} className="flex items-center gap-1">
          <span
            className={cn(
              "rounded border px-2 py-1 font-mono text-xs",
              hop.status === "halt"
                ? "border-destructive/50 bg-destructive/5 text-destructive"
                : "bg-muted/50",
            )}
            title={hop.note}
          >
            {hop.node}
            <span className="ml-1.5 text-muted-foreground">{hop.latencyMs}ms</span>
          </span>
          {index < hops.length - 1 && <span className="text-muted-foreground">→</span>}
        </li>
      ))}
    </ol>
  );
}

/** A cost delta. Savings read green, costs read red — the sign is never ambiguous. */
export function SgdDelta({ value, className }: { value: number; className?: string }) {
  const tone = value < 0 ? "text-success" : value > 0 ? "text-destructive" : "text-muted-foreground";
  const label = value < 0 ? "saving" : value > 0 ? "cost" : "neutral";
  return (
    <span className={cn("tabular font-medium", tone, className)}>
      {value < 0 ? "−" : value > 0 ? "+" : ""}S${Math.abs(value).toFixed(2)}
      <span className="ml-1 text-xs font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

/** Required on every screen: the data is synthetic and must say so. */
export function DataNotice() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">Synthetic data.</span> Every site, lease, transcript and
      chiller reading in this demo is generated from a fixed seed. No real Keppel or personal data
      is used.
    </p>
  );
}
