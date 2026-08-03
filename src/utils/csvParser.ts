/**
 * RFC 4180 compliant CSV Parser
 * Handles multiline quoted fields, escaped quotes, and various delimiters
 */
export class CSVParser {
  /**
   * Parse CSV text into headers and rows
   * Uses character-by-character parsing to properly handle:
   * - Multiline fields within quotes
   * - Escaped quotes ("" inside quoted fields)
   * - Commas within quoted fields
   */
  static parseCSV(text: string): { headers: string[], rows: string[][] } {
    console.log('=== CSVParser.parseCSV START ===');
    console.log('Input length:', text?.length || 0);
    
    if (!text || text.trim() === '') {
      console.warn('CSVParser: Empty input');
      return { headers: [], rows: [] };
    }

    const result: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (!inQuotes) {
          // Start of quoted field
          inQuotes = true;
          i++;
        } else if (nextChar === '"') {
          // Escaped quote ("") inside quoted field
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field delimiter (outside quotes)
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        // Row delimiter (outside quotes)
        // Handle Windows line endings (\r\n)
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        
        // Push the current field
        currentRow.push(currentField.trim());
        
        // Only add row if it has content (skip empty rows)
        if (currentRow.some(field => field !== '')) {
          result.push(currentRow);
        }
        
        currentRow = [];
        currentField = '';
        i++;
      } else {
        // Regular character (including newlines inside quotes)
        currentField += char;
        i++;
      }
    }

    // Handle the last field and row
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field !== '')) {
      result.push(currentRow);
    }

    // First row is headers, rest are data rows
    if (result.length === 0) {
      console.warn('CSVParser: No rows parsed');
      return { headers: [], rows: [] };
    }

    const headers = result[0];
    const rows = result.slice(1);

    console.log('=== CSVParser.parseCSV COMPLETE ===');
    console.log(`Parsed ${rows.length} data rows with ${headers.length} columns`);
    console.log('Headers:', headers);
    
    // Log first row for debugging
    if (rows.length > 0) {
      console.log('First data row (raw):', rows[0]);
    }
    
    return { headers, rows };
  }

  /**
   * Parse a single CSV line (legacy method for backward compatibility)
   */
  static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    
    result.push(current.trim());
    return result.map(field => field.replace(/^"|"$/g, '')); // Remove surrounding quotes
  }

  /**
   * Convert data array to CSV string
   */
  static toCSV(data: any[], headers: string[]): string {
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.map(header => this.escapeCSVField(header)).join(','));
    
    // Add data rows
    data.forEach(row => {
      const csvRow = headers.map(header => {
        const value = row[header];
        return this.escapeCSVField(String(value || ''));
      });
      csvRows.push(csvRow.join(','));
    });
    
    return csvRows.join('\n');
  }

  /**
   * Escape a field value for CSV output. Neutralizes CSV formula-injection
   * (CWE-1236) before applying delimiter/quote/newline escaping.
   */
  static escapeCSVField(field: string): string {
    let str = String(field ?? '');
    const first = str.charAt(0);
    if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
      str = `'${str}`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

}
