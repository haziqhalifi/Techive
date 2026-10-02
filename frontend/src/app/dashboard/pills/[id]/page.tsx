import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ClaimBadge } from "@/components/claim-badge";
import { ErrorPanel } from "@/components/error-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/utils";
import type { PillDetail, PillVersion } from "@/types";

export const dynamic = "force-dynamic";

const EVAL_VARIANT = {
  passed: "success",
  failed: "destructive",
  pending: "muted",
} as const;

function VersionBlock({
  version,
  isLive,
  excerpts,
}: {
  version: PillVersion;
  isLive: boolean;
  excerpts: Map<string, string>;
}) {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isLive ? "success" : "muted"}>v{version.version}</Badge>
        <Badge variant="outline">{humanise(version.status)}</Badge>
        <Badge variant={EVAL_VARIANT[version.eval_status]}>
          eval {version.eval_status}
          {version.eval_score !== null && ` · ${version.eval_score.toFixed(2)}`}
        </Badge>
        {isLive && <Badge variant="default">live</Badge>}
      </div>

      <Separator className="my-3" />

      <p className="text-xs uppercase tracking-wide text-muted-foreground">Claims</p>
      <ul className="mt-2 flex flex-col gap-2">
        {version.claims.map((claim, index) => (
          <li key={`${version.version}-${index}`} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ClaimBadge kind={claim.kind} />
              <span>{claim.text}</span>
            </div>
            {claim.source_excerpt_id ? (
              <blockquote className="mt-1 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
                &ldquo;{excerpts.get(claim.source_excerpt_id) ?? "(excerpt not loaded)"}&rdquo;
                <span className="ml-1 not-italic">— {claim.source_excerpt_id}</span>
              </blockquote>
            ) : (
              <p className="mt-1 pl-3 text-xs text-muted-foreground">
                Marked unknown — the system did not invent a source.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Options</p>
      <ul className="mt-2 flex flex-col gap-2">
        {version.options.map((option) => (
          <li key={option.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{option.label}</span>
              <Badge variant={option.tier === "escalate" ? "destructive" : "default"}>
                {humanise(option.tier)}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{option.detail}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              <code className="font-mono">{option.id}</code>
              {option.source_excerpt_id && ` · ${option.source_excerpt_id}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function PillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let pill: PillDetail | null = null;
  let error: string | null = null;

  try {
    pill = await api.getPill(id);
  } catch (cause) {
    error = errorMessage(cause);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to console
      </Link>

      {error && <ErrorPanel title="Cannot load this pill" message={error} />}

      {pill && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{pill.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <code className="font-mono">{pill.id}</code> · {humanise(pill.domain)} · {pill.layer}{" "}
              layer · access {pill.access_class}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Context (transfer filter)</CardTitle>
                <CardDescription>FR-09 — a mismatch blocks transfer.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {pill.context ? (
                  Object.entries(pill.context).map(([key, value]) => (
                    <p key={key} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{humanise(key)}</span>
                      <code className="font-mono text-xs">{String(value)}</code>
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">No context recorded.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Critical cues</CardTitle>
                <CardDescription>Signals the expert treats as decisive.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {pill.critical_cues.map((cue) => (
                    <li key={cue}>{cue}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Discounted signals</CardTitle>
                <CardDescription>Alarming but usually innocent.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {pill.discounted_signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive">Never do</CardTitle>
              <CardDescription>The boundary that stops a wasteful fix.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 text-sm">
                {pill.never_do.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Versions</h2>
            {[...pill.versions].reverse().map((version) => (
              <VersionBlock
                key={version.version}
                version={version}
                isLive={version.version === pill.current_version}
                excerpts={new Map(pill.evidence.map((excerpt) => [excerpt.id, excerpt.text]))}
              />
            ))}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Capture evidence</CardTitle>
              <CardDescription>
                The chief engineer&rsquo;s own words. Every grounded claim traces back here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {pill.evidence.map((excerpt) => (
                <blockquote
                  key={excerpt.id}
                  className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground"
                >
                  &ldquo;{excerpt.text}&rdquo;
                  <footer className="mt-1 text-xs">
                    — {excerpt.speaker}, <code className="font-mono">{excerpt.id}</code>,{" "}
                    {formatDateTime(excerpt.occurred_at)}
                  </footer>
                </blockquote>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
