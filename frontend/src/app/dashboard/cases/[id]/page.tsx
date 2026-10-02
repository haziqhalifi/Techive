import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DecisionCardView } from "@/components/decision-card";
import { ErrorPanel } from "@/components/error-panel";
import { api, errorMessage } from "@/lib/api";
import type { DecisionCard } from "@/types";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let card: DecisionCard | null = null;
  let error: string | null = null;

  try {
    card = await api.getCase(id);
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

      {error && <ErrorPanel title="Cannot load this case" message={error} />}
      {card && <DecisionCardView card={card} />}
    </div>
  );
}
