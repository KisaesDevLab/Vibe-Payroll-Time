// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const aiProviderSchema = z.enum(['anthropic', 'openai_compatible', 'ollama']);
export type AIProvider = z.infer<typeof aiProviderSchema>;

export const aiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiProvider: aiProviderSchema,
  aiModel: z.string().nullable(),
  aiBaseUrl: z.string().nullable(),
  aiApiKeyConfigured: z.boolean(),
  aiDailyCorrectionLimit: z.number().int().min(0).max(500),
});
export type AISettings = z.infer<typeof aiSettingsSchema>;

/**
 * Validate a user-supplied AI base URL before the backend sends HTTP
 * traffic to it. Without this, an operator who gains company_admin
 * access could point the base URL at an internal service (cloud
 * metadata IMDS, RFC-1918 intranet host, localhost-bound admin pane)
 * and use the NL-correction / support-chat feature as an SSRF
 * primitive. We require http(s) scheme and reject the AWS/GCP/Azure
 * metadata IP explicitly; for stricter SSRF containment on a hardened
 * deployment, operators should place the backend behind an egress
 * allowlist (this regex is fast fail-closed for the common cases).
 */
const aiBaseUrlSchema = z
  .string()
  .max(512)
  .refine((v) => /^https?:\/\//i.test(v), 'aiBaseUrl must be an http(s) URL')
  .refine(
    (v) => !/^https?:\/\/169\.254\./i.test(v),
    'aiBaseUrl cannot target the cloud metadata address 169.254.x.x',
  )
  .refine(
    (v) => !/^https?:\/\/\[?fd00:ec2::254/i.test(v),
    'aiBaseUrl cannot target the cloud metadata address fd00:ec2::254',
  );

export const updateAISettingsRequestSchema = z
  .object({
    aiEnabled: z.boolean(),
    aiProvider: aiProviderSchema,
    aiModel: z.string().max(128).nullable(),
    /** null = clear; string = replace; omit = leave untouched. */
    aiApiKey: z.string().max(512).nullable().optional(),
    aiBaseUrl: aiBaseUrlSchema.nullable(),
    aiDailyCorrectionLimit: z.number().int().min(0).max(500),
  })
  .partial();
export type UpdateAISettingsRequest = z.infer<typeof updateAISettingsRequestSchema>;

// ---------------------------------------------------------------------------
// Natural-language timesheet correction
// ---------------------------------------------------------------------------

export const nlCorrectionRequestSchema = z.object({
  /** Employee whose timesheet the user is correcting. For an employee
   *  acting on themselves, pass their own employeeId. Managers can act
   *  on any employee in their scope. */
  employeeId: z.number().int().positive(),
  prompt: z.string().min(1).max(1000),
  /** Pay period window so the LLM has a fixed context to reason over. */
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type NLCorrectionRequest = z.infer<typeof nlCorrectionRequestSchema>;

/** One proposed edit the LLM wants to make — sent to the UI for a
 *  human-in-the-loop confirmation before anything persists. */
export const nlCorrectionToolCallSchema = z.object({
  id: z.string(), // opaque id the UI passes back when confirming
  name: z.enum(['edit_entry', 'delete_entry', 'add_entry']),
  arguments: z.record(z.string(), z.unknown()),
  /** Human-readable description the UI renders in the diff preview. */
  summary: z.string(),
});
export type NLCorrectionToolCall = z.infer<typeof nlCorrectionToolCallSchema>;

export const nlCorrectionPreviewSchema = z.object({
  /** The LLM's free-text response — shown above the diff. */
  narrative: z.string(),
  toolCalls: z.array(nlCorrectionToolCallSchema),
  /** Leftover budget after this preview. Counted against the daily
   *  rate limit regardless of whether the preview is applied. */
  remainingQuota: z.number().int().nonnegative(),
});
export type NLCorrectionPreview = z.infer<typeof nlCorrectionPreviewSchema>;

export const nlCorrectionApplyRequestSchema = z.object({
  employeeId: z.number().int().positive(),
  originalPrompt: z.string().min(1).max(1000),
  // Cap the tool-call batch so a crafted request can't cause hundreds
  // of serialized edit/delete transactions per HTTP call. Realistic
  // LLM previews emit 1–10 calls; 50 is generous.
  toolCalls: z.array(nlCorrectionToolCallSchema).min(1).max(50),
});
export type NLCorrectionApplyRequest = z.infer<typeof nlCorrectionApplyRequestSchema>;

export const nlCorrectionApplyResultSchema = z.object({
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ toolCallId: z.string(), message: z.string() })),
});
export type NLCorrectionApplyResult = z.infer<typeof nlCorrectionApplyResultSchema>;

// ---------------------------------------------------------------------------
// Support chat
// ---------------------------------------------------------------------------

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  // Per-message cap prevents someone from stuffing 1MB into one message
  // to defeat the array cap below.
  content: z.string().max(8000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  // Cap the turn history. 40 turns is well past the useful context
  // window for the support-chat use case (QA over bundled docs).
  messages: z.array(chatMessageSchema).min(1).max(40),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Non-streaming response — streaming variant is hit at a separate
 *  endpoint that returns text/event-stream. */
export const chatResponseSchema = z.object({
  reply: z.string(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
