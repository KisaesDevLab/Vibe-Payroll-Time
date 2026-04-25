// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Locks in two render-pipeline invariants the templates depend on:
 *
 *   1. Mustache-style `{{#key}}…{{/key}}` sections are honoured: the
 *      inner block renders when the variable is non-empty and is
 *      stripped (along with its wrappers) when the variable is missing
 *      or blank. Before this support landed, the `correction_request_decided`
 *      HTML email shipped raw `{{#reviewNote}}<p>...</p>{{/reviewNote}}`
 *      markup to managers when no review note was supplied.
 *
 *   2. HTML interpolation escapes user-supplied content so a `<script>`
 *      tag in a correction reason can't compromise a manager's email
 *      preview. Plaintext + SMS render unchanged.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../templates.js';

describe('renderTemplate', () => {
  describe('correction_request_decided', () => {
    it('omits the reviewNote section entirely when reviewNote is missing', () => {
      const out = renderTemplate('correction_request_decided', {
        firstName: 'Jess',
        decision: 'rejected',
        reviewerName: 'Kurt',
        timesheetUrl: 'https://example.local/timesheet',
      });
      // The HTML must not contain the literal Mustache section markers
      // and must not render the "Note:" label when there's no note to show.
      expect(out.html).not.toMatch(/\{\{[#/]/);
      expect(out.html).not.toContain('Note:');
      expect(out.html).toContain('rejected');
      expect(out.html).toContain('Kurt');
    });

    it('renders the reviewNote section when reviewNote is supplied', () => {
      const out = renderTemplate('correction_request_decided', {
        firstName: 'Jess',
        decision: 'approved',
        reviewerName: 'Kurt',
        reviewNote: 'Looks good — applied as requested.',
        timesheetUrl: 'https://example.local/timesheet',
      });
      expect(out.html).toContain('Note: Looks good');
      expect(out.html).not.toMatch(/\{\{[#/]/);
    });

    it('treats a whitespace-only reviewNote as missing', () => {
      const out = renderTemplate('correction_request_decided', {
        firstName: 'Jess',
        decision: 'approved',
        reviewerName: 'Kurt',
        reviewNote: '   ',
        timesheetUrl: 'https://example.local/timesheet',
      });
      expect(out.html).not.toContain('Note:');
    });
  });

  describe('HTML escaping', () => {
    it('escapes a script tag inside reason on the manager-facing email', () => {
      const out = renderTemplate('correction_request_received', {
        managerName: 'Kurt',
        employeeName: 'Jess',
        companyName: 'Acme',
        reason: '<script>alert(1)</script>',
        inboxUrl: 'https://example.local/inbox',
      });
      expect(out.html).not.toContain('<script>alert(1)</script>');
      expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      // Plaintext channels deliver the raw value; escaping is HTML-only.
      expect(out.text).toContain('<script>alert(1)</script>');
      // SMS template doesn't include `reason`, so just sanity-check a known token.
      expect(out.sms).toContain('Jess');
    });
  });
});
