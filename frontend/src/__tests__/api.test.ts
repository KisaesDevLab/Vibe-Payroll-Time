// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';

describe('ApiError', () => {
  it('carries status, code, and message', () => {
    const err = new ApiError(400, 'bad_request', 'nope', { foo: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.code).toBe('bad_request');
    expect(err.message).toBe('nope');
    expect(err.details).toEqual({ foo: 1 });
  });
});
