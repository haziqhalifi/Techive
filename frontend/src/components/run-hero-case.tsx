"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

/**
 * Runs the hero case end to end: loads the pre-filled synthetic complaint, posts it to the
 * pipeline, then opens the resulting decision card.
 */
export function RunHeroCaseButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const heroCase = await api.getHeroCase();
      const card = await api.createCase(heroCase);
      startTransition(() => router.push(`/dashboard/cases/${card.case_id}`));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={run} disabled={working}>
        {working ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {working ? "Running…" : "Run hero case"}
      </Button>
      {error && <p className="max-w-md text-xs text-destructive">{error}</p>}
    </div>
  );
}
