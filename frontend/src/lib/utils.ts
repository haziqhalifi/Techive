import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NUMBER = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 });

/** kWh delta. Negative = saves energy. */
export function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "0 kWh";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${NUMBER.format(Math.abs(value))} kWh`;
}

export function formatSgd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}S$${NUMBER.format(Math.abs(value))}`;
}

export function formatKwrt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)} kW/RT`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(date);
}

/** Human label for a snake_case enum value. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
