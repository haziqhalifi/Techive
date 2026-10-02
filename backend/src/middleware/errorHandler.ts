/**
 * Terminal middleware. Every error leaves the API in one shape:
 *   { "error": { "code": "...", "message": "...", "details": { ... } } }
 *
 * Internal errors never leak a stack trace to the client.
 */

import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { isVerdantError } from "@/shared/errors";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "not_found",
      message: `No route matches ${req.method} ${req.path}.`,
      details: {},
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isVerdantError(error)) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "validation_failure",
        message: "Request failed validation.",
        details: { issues: error.issues },
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  res.status(500).json({
    error: { code: "internal_error", message, details: {} },
  });
};
