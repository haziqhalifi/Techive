/**
 * Typed domain errors.
 *
 * Every expected failure throws one of these; `middleware/errorHandler.ts` renders it as
 *   { "error": { "code": "...", "message": "...", "details": {...} } }
 */

export type ErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_failure"
  | "pipeline_error"
  | "internal_error";

export class VerdantError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status = 400,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends VerdantError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} '${id}' was not found.`, 404, { entity, id });
  }
}

/** A governance rule rejected the request (e.g. FR-02 provenance, FR-03 authorship). */
export class ValidationFailure extends VerdantError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("validation_failure", message, 422, details);
  }
}

/** Deny-by-default: the caller's role may not perform this action. */
export class ForbiddenError extends VerdantError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("forbidden", message, 403, details);
  }
}

export class ConflictError extends VerdantError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, 409, details);
  }
}

/** The decision pipeline itself failed. */
export class PipelineError extends VerdantError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("pipeline_error", message, 500, details);
  }
}

export function isVerdantError(error: unknown): error is VerdantError {
  return error instanceof VerdantError;
}
