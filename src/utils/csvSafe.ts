/**
 * Neutralize CSV formula-injection payloads (CWE-1236). When Excel / Google
 * Sheets / LibreOffice open a CSV, any cell whose first character is `=`, `+`,
 * `-`, `@`, a tab, or a carriage return is interpreted as a formula — allowing
 * a user-entered comment like `=HYPERLINK("http://evil/","x")` to fire on the
 * next person who opens the export.
 *
 * We prefix such cells with a single quote, matching the OWASP-recommended
 * mitigation. The quote is not part of the visible value once the spreadsheet
 * parses the cell.
 */
export function neutralizeCsvFormula(value: string): string {
  if (!value) return value;
  const first = value.charAt(0);
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return `'${value}`;
  }
  return value;
}

/**
 * Escape a single field for CSV output: neutralize any leading formula
 * character, then quote/escape if it contains a delimiter, quote, or newline.
 */
export function escapeCsvCell(value: unknown): string {
  const str = neutralizeCsvFormula(String(value ?? ''));
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
