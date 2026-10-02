import { Badge } from "@/components/ui/badge";
import type { ClaimKind } from "@/types";
import { humanise } from "@/lib/utils";

const VARIANT: Record<ClaimKind, "default" | "success" | "warning" | "muted" | "destructive"> = {
  fact: "success",
  interpretation: "default",
  action: "warning",
  unknown: "muted",
};

/**
 * Colour-coded claim kind. `unknown` is deliberately muted: the system marks what the
 * expert did NOT say rather than inventing it (FR-02).
 */
export function ClaimBadge({ kind }: { kind: ClaimKind }) {
  return <Badge variant={VARIANT[kind]}>{humanise(kind)}</Badge>;
}
