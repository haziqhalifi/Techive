import { Activity, ArrowLeftRight, BookOpen, ClipboardList, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { DataNotice } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { useRole } from "@/hooks/use-role";
import { api } from "@/lib/verdant-api";
import { cn } from "@/lib/utils";
import type { Role, SeedStatus } from "@/types/verdant";

const NAV = [
  { to: "/", label: "Case console", icon: Activity, end: true },
  { to: "/pills", label: "Pill library", icon: BookOpen, end: false },
  { to: "/capture", label: "Capture interview", icon: ClipboardList, end: false },
  { to: "/transfer", label: "Transfer check", icon: ArrowLeftRight, end: false },
  { to: "/audit", label: "Audit log", icon: ShieldCheck, end: false },
];

export default function Layout() {
  const { role, roles, setRole, permissions, loading } = useRole();
  const [status, setStatus] = useState<SeedStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .seedStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        // The header is informational; a failure here must not blank the console.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const active = roles.find((entry) => entry.role === role);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <div className="border-b px-5 py-5">
          <div className="text-sm font-semibold tracking-tight">VERDANT</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Tower K Energy &amp; Comfort Pill
          </div>
        </div>

        <nav className="flex-1 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {status !== null && (
          <div className="space-y-1.5 border-t p-4 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Seed</span>
              <span className="tabular font-mono">{status.seed}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Model</span>
              <Badge variant={status.llmEnabled ? "warning" : "secondary"}>
                {status.llmEnabled ? "on" : "off"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Pills</span>
              <span className="tabular">{status.counts.pills}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Audit entries</span>
              <span className="tabular">{status.counts.auditEntries}</span>
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="text-sm font-semibold lg:hidden">VERDANT</div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Acting as
                </span>
                <Select
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                  disabled={loading}
                  aria-label="Acting role"
                  className="h-8 w-60 text-xs"
                >
                  {roles.map((entry) => (
                    <option key={entry.role} value={entry.role}>
                      {entry.label}
                    </option>
                  ))}
                  {roles.length === 0 && <option value={role}>{role}</option>}
                </Select>
              </div>
              <Badge variant="outline">{permissions.length} permissions</Badge>
            </div>
          </div>

          {active !== undefined && (
            <div className="border-t bg-muted/40 px-5 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Can:</span> {active.description.can}
              <span className="mx-2">·</span>
              <span className="font-medium text-foreground">Cannot:</span>{" "}
              {active.description.cannot}
            </div>
          )}
        </header>

        <main className="min-w-0 flex-1 p-5 lg:p-8">
          <Outlet />
        </main>

        <footer className="border-t px-5 py-4 lg:px-8">
          <DataNotice />
        </footer>
      </div>
    </div>
  );
}
