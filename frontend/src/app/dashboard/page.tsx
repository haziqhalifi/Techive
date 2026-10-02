import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ErrorPanel } from "@/components/error-panel";
import { RunHeroCaseButton } from "@/components/run-hero-case";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanise } from "@/lib/utils";
import type { CaseListResponse, PillListResponse } from "@/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let pills: PillListResponse | null = null;
  let cases: CaseListResponse | null = null;
  let error: string | null = null;

  try {
    [pills, cases] = await Promise.all([api.listPills(), api.listCases()]);
  } catch (cause) {
    error = errorMessage(cause);
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Console</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Run the hero case, then open the decision card. The card shows ranked options, the
            deterministic kWh impact of each lever, the tenant renewal flag, and the pill version and
            excerpt behind every option.
          </p>
        </div>
        <RunHeroCaseButton />
      </section>

      {error && (
        <ErrorPanel
          title="Cannot reach the backend"
          message={error}
          hint="Start the API first: cd backend && python -m uvicorn app.main:app --reload --port 8000. The database is only needed for pills and cases, not for the health check."
        />
      )}

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approved pills</CardTitle>
            <CardDescription>
              Only approved pills can reach the agents. Click one to see its claims and evidence.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pills && pills.count > 0 ? (
              <ul className="flex flex-col gap-2">
                {pills.pills.map((pill) => (
                  <li key={pill.id}>
                    <Link
                      href={`/dashboard/pills/${pill.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted"
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">{pill.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {pill.id} · {humanise(pill.domain)} · {pill.layer} layer
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge variant="success">v{pill.current_version}</Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              !error && <p className="text-sm text-muted-foreground">No approved pills yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent cases</CardTitle>
            <CardDescription>Every run is stored with its gate, metrics and options.</CardDescription>
          </CardHeader>
          <CardContent>
            {cases && cases.count > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reported</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.cases.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(record.reported_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {record.site_id}
                        {record.level !== null && ` · L${record.level}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={record.status === "open" ? "default" : "warning"}>
                          {humanise(record.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/dashboard/cases/${record.id}`}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Card
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              !error && (
                <p className="text-sm text-muted-foreground">
                  No cases yet. Run the hero case to create one.
                </p>
              )
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
