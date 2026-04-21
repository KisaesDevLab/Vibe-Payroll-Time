import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const Unauthorized = (message = 'Unauthorized') =>
  new HttpError(401, 'unauthorized', message);
export const Forbidden = (message = 'Forbidden') => new HttpError(403, 'forbidden', message);
export const NotFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const Conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'conflict', message, details);
export const TooManyRequests = (message = 'Too many requests') =>
  new HttpError(429, 'rate_limited', message);

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Route not found',
    },
  });
}

// Express 4 error handlers must keep the 4-argument signature, hence the
// unused `_next`. We explicitly suppress the unused-var warning.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: err.issues,
      },
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Internal server error',
    },
  });
}
