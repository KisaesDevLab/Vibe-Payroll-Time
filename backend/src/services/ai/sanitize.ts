/**
 * Prompt-injection hardening. Applied to every user-provided string
 * before it reaches the LLM. The goal isn't to block a determined
 * attacker — it's to stop an accidental paste of something that
 * looks like a directive from wandering into the system prompt.
 */

const MAX_PROMPT_CHARS = 4_000;

const ROLEPLAY_PHRASES = [
  'ignore previous instructions',
  'ignore the above',
  'disregard the prior',
  'system prompt',
  'you are now',
  'act as',
  'pretend to be',
];

export function sanitizeUserInput(text: string): string {
  let out = text.trim();
  if (out.length > MAX_PROMPT_CHARS) out = out.slice(0, MAX_PROMPT_CHARS);

  // Strip anything that looks like a role marker an attacker might slip
  // into their prompt. The LLM won't treat quoted content as a directive,
  // but removing these tokens keeps the audit trail clean.
  out = out.replace(/<\/?(system|assistant|user|tool)>/gi, '');

  return out;
}

export function detectInjectionHeuristic(text: string): boolean {
  const lower = text.toLowerCase();
  return ROLEPLAY_PHRASES.some((p) => lower.includes(p));
}

/** Prepend a guard the support chat sees on every user turn. It's a
 *  system-prompt afterthought: if a user tries to get the chat to
 *  take actions on their behalf, the chat politely punts. */
export const SUPPORT_CHAT_GUARDRAIL = `
You are the Vibe Payroll Time support chat. You answer questions about
how Vibe PT works using the documentation provided below. You never
take actions on the user's behalf — no clocking in/out, no editing
timesheets, no running exports, no sending messages. If the user
asks you to change data or take an action, respond with:

  "I can't change data. Try the 'Ask assistant' on your timesheet page
   for natural-language corrections, or ask an admin."

Keep answers short. Cite the relevant doc section when helpful.
`;
