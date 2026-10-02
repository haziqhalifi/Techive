import { CheckCircle2, ShieldAlert } from "lucide-react";

import { ErrorPanel } from "@/components/error-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/utils";
import type { AuditAction, AuditListResponse } from "@/types";

export const dynamic = "force-dynamic";

const ACTION_VARIANT: Record<AuditAction, "default" | "success" | "warning" | "destructive" | "muted"> =
  {
    capture: "default",
    view: "muted",
    apply: "default",
    approve: "success",
    reject: "warning",
    rollback: "warning",
    export: "muted",
    gate_escalate: "destructive",
    context_block: "destructive",
  };

export default async function AuditPage() {
  let audit: AuditListResponse | null = null;
  let error: string | null = null;

  try {
    audit = await api.listAudit();
  } catch (cause) {
    error = errorMessage(cause);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Append-only and hash-chained: each entry commits to the one before it, so tampering is
          detectable. The database additionally refuses UPDATE and DELETE on this table.
        </p>
      </div>

      {error && <ErrorPanel title="Cannot load the audit trail" message={error} />}

      {audit && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {audit.chain_valid ? (
              <Badge variant="success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Chain verified
              </Badge>
            ) : (
              <Badge variant="destructive">
                <ShieldAlert className="h-3.5 w-3.5" /> Chain broken at seq {audit.broken_at_seq}
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">{audit.count} entries</span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Entries</CardTitle>
              <CardDescription>
                Read-only. Hashes are truncated for display; the full chain is verified server-side.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {audit.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No entries yet. Run the hero case to write the first one.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Seq</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Hash</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...audit.entries].reverse().map((entry) => (
                      <TableRow key={entry.seq}>
                        <TableCell className="font-mono text-xs">{entry.seq}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(entry.occurred_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ACTION_VARIANT[entry.action]}>
                            {humanise(entry.action)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="text-muted-foreground">{entry.entity_type}</span>{" "}
                          <code className="font-mono">{entry.entity_id.slice(0, 8)}…</code>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.actor_role ? humanise(entry.actor_role) : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {entry.hash.slice(0, 12)}…
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
