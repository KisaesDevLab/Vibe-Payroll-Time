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

export const updateAISettingsRequestSchema = z
  .object({
    aiEnabled: z.boolean(),
    aiProvider: aiProviderSchema,
    aiModel: z.string().max(128).nullable(),
    /** null = clear; string = replace; omit = leave untouched. */
    aiApiKey: z.string().max(512).nullable().optional(),
    aiBaseUrl: z.string().max(512).nullable(),
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
  toolCalls: z.array(nlCorrectionToolCallSchema).min(1),
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
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Non-streaming response — streaming variant is hit at a separate
 *  endpoint that returns text/event-stream. */
export const chatResponseSchema = z.object({
  reply: z.string(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
