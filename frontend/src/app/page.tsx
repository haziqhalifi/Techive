import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldAlert, ThermometerSun } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CONTRACT = [
  ["Red-flag gate (FR-08)", "Pure rules — runs before any model call"],
  ["Case parsing", "Deterministic regex + enums"],
  ["Context check (FR-09)", "Deterministic comparison"],
  ["Metrics (FR-04)", "Pure maths — kW/RT, drift, kWh"],
  ["Claim validation (FR-02)", "Rejected without a source excerpt"],
  ["Audit chain (FR-11)", "sha256 hash chain, append-only"],
  ["Pill ranking", "The model's only job: pick one ID"],
] as const;

const NOT_A_CHATBOT = [
  "Humans approve every action that acts",
  "Numbers come from code, never the model",
  "The AI selects a pill by ID — it never writes guidance",
  "Versions are tested, then rolled back if they fail",
  "Access is scoped by role and site",
  "The model can be swapped by config",
  "Provenance is stored per excerpt",
  "Nothing is written back to the BMS",
] as const;

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <span className="synthetic-badge w-fit">Synthetic data</span>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight">
          When Tower K&rsquo;s chief engineer retires, his judgement on cooling and comfort stays —
          approved, versioned and measurable.
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          A governed <strong>Intelligence Pill</strong> platform for a synthetic Singapore Grade-A
          office tower. The AI never writes guidance: it selects an approved pill by ID, every number
          is computed deterministically in code, and a human approves anything that acts.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard" className={cn(buttonVariants())}>
            Open the console <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/dashboard/audit" className={cn(buttonVariants({ variant: "outline" }))}>
            View the audit trail
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <ThermometerSun className="h-5 w-5" />
              <CardTitle>The hero case</CardTitle>
            </div>
            <CardDescription>One case carries the whole demo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              At <strong>2:40pm</strong>, a tenant on Level 23 logs &ldquo;too hot&rdquo;. Over two
              weeks the chiller plant&rsquo;s efficiency has drifted from{" "}
              <strong>0.62 to 0.71 kW/RT</strong>.
            </p>
            <p>
              A junior engineer&rsquo;s instinct is to lower the building-wide setpoint — fixing one
              zone and wasting energy across the whole tower. The pill stops that and steers to the
              zone-level cause.
            </p>
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
              Never lower the building-wide setpoint for a single-zone complaint.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle>The determinism contract</CardTitle>
            </div>
            <CardDescription>
              The single rule that makes the governance story real.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {CONTRACT.map(([concern, detail]) => (
                <li key={concern} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>
                    <span className="font-medium">{concern}</span>
                    <span className="text-muted-foreground"> — {detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              An architecture test fails the build if a deterministic module ever imports an LLM.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Why it&rsquo;s not a chatbot</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {NOT_A_CHATBOT.map((item) => (
            <li
              key={item}
              className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
