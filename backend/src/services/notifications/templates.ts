/**
 * Notification templates. Hand-rolled string interpolation —
 * `{{key}}` placeholders in the template are replaced with the
 * matching field from `vars`. Missing keys render as empty strings
 * rather than throwing, so a template refactor never crashes a cron.
 *
 * Templates ship email + SMS + subject triples so a single
 * NotificationType maps to both channels.
 */

export type NotificationType =
  | 'password_reset'
  | 'magic_link'
  | 'missed_punch_reminder'
  | 'timesheet_approval_deadline'
  | 'correction_request_received'
  | 'correction_request_decided'
  | 'pay_period_approved'
  | 'phone_verification';

export interface TemplateOutput {
  subject: string;
  html: string;
  text: string;
  /** Shortened SMS body — always under 160 chars so Twilio doesn't
   *  split it into multiple segments. */
  sms: string;
}

type TemplateVars = Record<string, string | number | null | undefined>;

function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

// ---------------------------------------------------------------------------
// Template bank. Keep subjects short and bodies plain — CPA-firm
// customers forward these to their own clients.
// ---------------------------------------------------------------------------

const TEMPLATES: Record<NotificationType, TemplateOutput> = {
  password_reset: {
    subject: 'Reset your {{appName}} password',
    html: `<p>Hi {{firstName}},</p>
<p>A password reset was requested for your {{appName}} account. Click the link below to choose a new password — the link is valid for 30 minutes.</p>
<p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
<p>If you didn't request this, ignore this email and your password stays the same.</p>`,
    text: `Hi {{firstName}},

A password reset was requested for your {{appName}} account. Open the link below to choose a new password — the link is valid for 30 minutes.

{{resetUrl}}

If you didn't request this, ignore this email.`,
    sms: '{{appName}}: reset your password at {{resetUrl}} (valid 30m)',
  },

  magic_link: {
    subject: 'Sign in to {{appName}}',
    html: `<p>Hi {{firstName}},</p>
<p>Click below to sign in to {{appName}}. The link is valid for 15 minutes.</p>
<p><a href="{{magicUrl}}">{{magicUrl}}</a></p>`,
    text: `Hi {{firstName}},

Click to sign in to {{appName}}. The link is valid for 15 minutes.

{{magicUrl}}`,
    sms: '{{appName}} sign-in: {{magicUrl}} (valid 15m)',
  },

  missed_punch_reminder: {
    subject: 'Still clocked in at {{companyName}}?',
    html: `<p>Hi {{firstName}},</p>
<p>You've had an open entry at {{companyName}} since {{startedAt}} ({{elapsedHours}} hours). If you forgot to clock out, sign in and fix it — the system will auto-close the entry in the meantime.</p>
<p><a href="{{myPunchUrl}}">Open my time</a></p>`,
    text: `Hi {{firstName}},

You've had an open entry at {{companyName}} since {{startedAt}} ({{elapsedHours}} hours). If you forgot to clock out, sign in and fix it:

{{myPunchUrl}}`,
    sms: 'Still clocked in at {{companyName}}? Fix: {{myPunchUrl}}',
  },

  timesheet_approval_deadline: {
    subject: 'Timesheet approval due for {{periodLabel}}',
    html: `<p>Hi {{firstName}},</p>
<p>The {{periodLabel}} pay period at {{companyName}} needs your approval. Please review and approve by {{deadline}}.</p>
<p><a href="{{reviewUrl}}">Review timesheets</a></p>`,
    text: `Hi {{firstName}},

The {{periodLabel}} pay period at {{companyName}} needs your approval by {{deadline}}.

{{reviewUrl}}`,
    sms: 'Timesheets need approval by {{deadline}}: {{reviewUrl}}',
  },

  correction_request_received: {
    subject: '{{employeeName}} requested a timesheet correction',
    html: `<p>Hi {{managerName}},</p>
<p>{{employeeName}} submitted a correction request at {{companyName}}.</p>
<blockquote>{{reason}}</blockquote>
<p><a href="{{inboxUrl}}">Open the inbox</a></p>`,
    text: `Hi {{managerName}},

{{employeeName}} submitted a correction request at {{companyName}}:

{{reason}}

{{inboxUrl}}`,
    sms: '{{employeeName}} needs a timesheet fix: {{inboxUrl}}',
  },

  correction_request_decided: {
    subject: 'Your correction request was {{decision}}',
    html: `<p>Hi {{firstName}},</p>
<p>Your correction request was <strong>{{decision}}</strong> by {{reviewerName}}.</p>
{{#reviewNote}}<p>Note: {{reviewNote}}</p>{{/reviewNote}}
<p><a href="{{timesheetUrl}}">Open my timesheet</a></p>`,
    text: `Hi {{firstName}},

Your correction request was {{decision}} by {{reviewerName}}. {{reviewNote}}

{{timesheetUrl}}`,
    sms: 'Correction {{decision}} by {{reviewerName}}: {{timesheetUrl}}',
  },

  pay_period_approved: {
    subject: 'Your {{periodLabel}} timesheet is approved',
    html: `<p>Hi {{firstName}},</p>
<p>Your timesheet for {{periodLabel}} at {{companyName}} was approved by {{managerName}}. Total: <strong>{{totalHours}} hours</strong>.</p>`,
    text: `Hi {{firstName}},

Your timesheet for {{periodLabel}} at {{companyName}} was approved by {{managerName}}. Total: {{totalHours}} hours.`,
    sms: '{{periodLabel}} approved — {{totalHours}} hrs.',
  },

  phone_verification: {
    subject: 'Phone verification code',
    html: `<p>Your {{appName}} phone verification code is <strong>{{code}}</strong>. It expires in 10 minutes.</p>`,
    text: `Your {{appName}} phone verification code is {{code}}. It expires in 10 minutes.`,
    sms: '{{appName}} verification code: {{code}} (valid 10m)',
  },
};

export function renderTemplate(type: NotificationType, vars: TemplateVars): TemplateOutput {
  const t = TEMPLATES[type];
  return {
    subject: render(t.subject, vars),
    html: render(t.html, vars),
    text: render(t.text, vars),
    sms: render(t.sms, vars),
  };
}
