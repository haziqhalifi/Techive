import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** SGD with a sign, so a saving reads as a saving. */
export function sgd(value: number, options: { signed?: boolean } = {}): string {
  const sign = options.signed === true && value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}S$${Math.abs(value).toFixed(2)}`;
}

/** kWh with a sign and thousands separators. */
export function kwh(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("en-SG", { maximumFractionDigits: 1 })} kWh`;
}

export function num(value: number, dp = 2): string {
  return value.toFixed(dp);
}

export function pct(value: number, dp = 1): string {
  return `${(value * 100).toFixed(dp)}%`;
}

export function clockOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
}

export function dateTimeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-SG", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Human label for an action tier. */
export const TIER_LABELS: Record<string, string> = {
  recommend: "Recommend",
  execute_with_approval: "Execute with approval",
  escalate: "Escalate",
  blocked: "Blocked",
};

/** Human label for a snake_case token. */
export function humanise(value: string): string {
  return value
    .split(/[_-]/)
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}
