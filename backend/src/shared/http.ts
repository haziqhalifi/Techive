/**
 * Small HTTP helpers. Express 4 does not forward rejected promises from async handlers to the
 * error middleware, so every async route must go through `asyncHandler`.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

type MaybeAsyncHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Wrap an async handler so a rejection reaches `errorHandler` instead of hanging the socket. */
export function asyncHandler(handler: MaybeAsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function readQueryString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

export function readQueryInt(value: unknown, fallback: number): number {
  const raw = readQueryString(value);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readQueryBool(value: unknown): boolean | undefined {
  const raw = readQueryString(value);
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
