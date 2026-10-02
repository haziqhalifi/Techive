import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { Empty, ErrorPanel, InfoNote, Loading, PageHeader, Section, Stat } from "@/components/shared";
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
import { dateTimeOf, humanise } from "@/lib/utils";
import type { AuditLogEntry, AuditVerification } from "@/types/harvest";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/types/harvest";

type Failure = { message: string; details?: Record<string, unknown> };

const ACTION_OPTIONS = Object.values(AUDIT_ACTIONS);

export default function AuditLog() {
  const { can, loading: roleLoading } = useRole();
  const allowed = can("audit:read");

  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [limit, setLimit] = useState("200");
  const [nonce, setNonce] = useState(0);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Failure | null>(null);

  useEffect(() => {
    if (roleLoading || !allowed) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .audit({
        entityType: entityType === "" ? undefined : entityType,
        action: action === "" ? undefined : action,
        entityId: entityId.trim() === "" ? undefined : entityId.trim(),
        limit: limit === "" ? undefined : Number(limit),
      })
      .then((response) => {
        if (cancelled) return;
        // Newest first reads better in a log viewer than the chain's insertion order.
        setEntries([...response.entries].reverse());
        setVerification(response.verification);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError({
            message: cause instanceof Error ? cause.message : "Could not load the audit log.",
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
  }, [roleLoading, allowed, entityType, action, entityId, limit, nonce]);

  if (!roleLoading && !allowed) {
    return (
      <>
        <PageHeader
          title="Audit log"
          description="Append-only and hash-chained. Read access is restricted to governance and review roles."
        />
        <InfoNote>
          Your role cannot read the audit log. Switch to <strong>Governance Admin</strong> or{" "}
          <strong>Pill Reviewer</strong> in the header.
        </InfoNote>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only and hash-chained (FR-11). Each entry commits to the previous entry's hash, so any edit or deletion is detectable."
        actions={
          <Button variant="outline" size="sm" onClick={() => setNonce((value) => value + 1)}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {error !== null && (
        <div className="mb-6">
          <ErrorPanel message={error.message} details={error.details} />
        </div>
      )}

      {verification !== null && (
        <section className="mb-6">
          <div
            className={`flex items-start gap-3 rounded-md border p-4 ${
              verification.valid
                ? "border-success/40 bg-success/5"
                : "border-destructive/50 bg-destructive/5"
            }`}
          >
            {verification.valid ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
            ) : (
              <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            )}
            <div>
              <p
                className={`text-sm font-semibold ${verification.valid ? "text-success" : "text-destructive"}`}
              >
                {verification.valid ? "Hash chain verified" : "Hash chain broken"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {verification.valid
                  ? `All ${verification.entries} entries link back to the genesis hash.`
                  : `The chain diverges at sequence ${verification.brokenAtSeq ?? "?"}.`}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Entries returned" value={entries.length} />
        <Stat
          label="Chain length"
          value={verification?.entries ?? "—"}
          hint="Verified server-side"
        />
        <Stat
          label="Integrity"
          value={verification?.valid === true ? "valid" : verification === null ? "—" : "broken"}
          tone={verification?.valid === true ? "success" : "destructive"}
        />
      </div>

      <Section
        title="Entries"
        description="Newest first. Select a row to inspect its payload and hash links."
        actions={
          <>
            <Select
              aria-label="Entity type filter"
              className="h-8 w-32 text-xs"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
            >
              <option value="">All entities</option>
              {AUDIT_ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanise(type)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Action filter"
              className="h-8 w-48 text-xs"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <div className="w-40">
              <Input
                aria-label="Entity id filter"
                className="h-8 text-xs"
                placeholder="entity id"
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
              />
            </div>
            <div className="w-24">
              <Label className="sr-only" htmlFor="audit-limit">
                Limit
              </Label>
              <Input
                id="audit-limit"
                type="number"
                className="h-8 text-xs"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </div>
          </>
        }
      >
        {loading ? (
          <Loading label="Reading the chain…" />
        ) : entries.length === 0 ? (
          <Empty message="No audit entries match the filter." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-14 text-right">Seq</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const isOpen = entry.id === expanded;
                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                    >
                      <TableCell>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right text-xs">{entry.seq}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {dateTimeOf(entry.occurredAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{entry.entityId}</div>
                        <div className="text-xs text-muted-foreground">{entry.entityType}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">{entry.actorName}</div>
                        <div className="text-xs text-muted-foreground">
                          {humanise(entry.actorRole)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.shortHash}
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/40">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Payload
                              </h4>
                              <pre className="mt-2 max-h-64 overflow-auto rounded bg-card p-3 text-xs">
                                {JSON.stringify(entry.payload, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Chain link
                              </h4>
                              <dl className="mt-2 space-y-2 text-xs">
                                <div>
                                  <dt className="text-muted-foreground">Entry id</dt>
                                  <dd className="font-mono">{entry.id}</dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">Previous hash</dt>
                                  <dd className="break-all font-mono">{entry.prevHash}</dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">This hash</dt>
                                  <dd className="break-all font-mono">{entry.hash}</dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">Actor</dt>
                                  <dd className="font-mono">
                                    {entry.actorId} · {entry.actorRole}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}
