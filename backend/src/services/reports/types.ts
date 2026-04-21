// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { ReportColumn, ReportDefinition } from '@vibept/shared';
import type { ZodType } from 'zod';

export interface ReportHandler<P extends ZodType> {
  name: string;
  label: string;
  description: string;
  columns: ReportColumn[];
  /** Field descriptors for the selector UI. Ordered. */
  paramFields: ReportDefinition['params'];
  /** Zod schema for server-side validation. */
  paramsSchema: P;
  rows: (
    companyId: number,
    params: import('zod').infer<P>,
  ) => AsyncIterable<Record<string, unknown>>;
}
