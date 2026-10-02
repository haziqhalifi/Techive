/**
 * Zod validation at the API boundary.
 *
 * Controllers use `parseOrThrow`; a `ZodError` is rendered as a 422 by `errorHandler`.
 * `validateBody` is provided for routes that prefer middleware-style validation.
 */

import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/** Parse or throw. Use at the top of a controller. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/** Validate `req.body` and stash the parsed value on `res.locals.body`. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    try {
      res.locals.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Read the value stashed by `validateBody`. */
export function bodyOf<T>(res: { locals: Record<string, unknown> }): T {
  return res.locals.body as T;
}
