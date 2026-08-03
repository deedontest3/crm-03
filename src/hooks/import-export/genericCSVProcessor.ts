import { supabase } from '@/integrations/supabase/client';
import { CSVParser } from '@/utils/csvParser';
// LeadsCSVProcessor removed - leads are now managed under Deals
import { createRecordValidator } from './recordValidator';
import { createHeaderMapper } from './headerMapper';
import { DateFormatUtils } from '@/utils/dateFormatUtils';
import { normalizeCountryName, getRegionForCountry } from '@/utils/countryRegionMapping';
import { 
  buildUserLookupMap, 
  isValidUUID,
  type UserResolverResult 
} from './userNameResolver';
import { runWithConcurrency } from './concurrentBatch';


export interface ProcessingOptions {
  tableName: string;
  userId: string;
  onProgress?: (processed: number, total: number) => void;
}

export interface ProcessingResult {
  successCount: number;
  updateCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: string[];
  userResolutionStats?: {
    resolved: number;
    fallback: number;
  };
}

export class GenericCSVProcessor {
  private userResolver: UserResolverResult | null = null;
  private userResolutionStats = { resolved: 0, fallback: 0 };

  async processCSV(csvText: string, options: ProcessingOptions): Promise<ProcessingResult> {
    console.log(`=== GenericCSVProcessor: Starting for table "${options.tableName}" ===`);
    
    // Leads module has been consolidated into Deals Lead stage
    // No special leads processor needed anymore

    const result: ProcessingResult = {
      successCount: 0,
      updateCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      errors: [],
      userResolutionStats: { resolved: 0, fallback: 0 }
    };

    try {
      // Build user lookup map for resolving text names to UUIDs
      console.log('Building user lookup map...');
      this.userResolver = await buildUserLookupMap();
      this.userResolutionStats = { resolved: 0, fallback: 0 };
      console.log('User lookup map ready with keys:', Object.keys(this.userResolver.userMap).length);

      // Parse CSV
      console.log('Parsing CSV...');
      const { headers, rows } = CSVParser.parseCSV(csvText);
      
      console.log(`Parsed ${rows.length} rows with ${headers.length} headers`);
      console.log('Headers:', headers);

      if (headers.length === 0) {
        throw new Error('No headers found in CSV file');
      }

      if (rows.length === 0) {
        console.warn('No data rows found in CSV');
        result.errors.push('No data rows found in CSV file');
        return result;
      }

      // Map headers to database columns
      const headerMapper = createHeaderMapper(options.tableName);
      const columnMap: Record<string, string> = {};
      const unmappedHeaders: string[] = [];
      
      headers.forEach(header => {
        const mappedColumn = headerMapper(header);
        if (mappedColumn) {
          columnMap[header] = mappedColumn;
          console.log(`Header mapping: "${header}" -> "${mappedColumn}"`);
        } else {
          unmappedHeaders.push(header);
          console.log(`Header not mapped (skipped): "${header}"`);
        }
      });
      
      console.log('=== Column mapping summary ===');
      console.log('Mapped columns:', Object.keys(columnMap).length);
      console.log('Unmapped headers:', unmappedHeaders);
      console.log('Column map:', columnMap);

      // Validate we have required columns
      if (Object.keys(columnMap).length === 0) {
        throw new Error('No CSV columns could be mapped to database fields. Please check your CSV headers.');
      }

      // Check for account_name mapping specifically
      const hasAccountName = Object.values(columnMap).includes('account_name');
      if (options.tableName === 'accounts' && !hasAccountName) {
        throw new Error('Required column "Account Name" not found in CSV. Available headers: ' + headers.join(', '));
      }

      // Process rows in batches
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: rows ${i + 1} to ${Math.min(i + batchSize, rows.length)}`);
        
        const batchResult = await this.processBatch(batch, headers, columnMap, options);
        
        result.successCount += batchResult.successCount;
        result.updateCount += batchResult.updateCount;
        result.duplicateCount += batchResult.duplicateCount;
        result.errorCount += batchResult.errorCount;
        result.errors.push(...batchResult.errors);

        // Report progress
        if (options.onProgress) {
          options.onProgress(Math.min(i + batchSize, rows.length), rows.length);
        }
      }

      // Add user resolution stats
      result.userResolutionStats = { ...this.userResolutionStats };
      
      console.log('=== GenericCSVProcessor: Processing complete ===');
      console.log('Results:', result);
      
      return result;

    } catch (error: any) {
      console.error('=== GenericCSVProcessor: Processing failed ===');
      console.error('Error:', error);
      throw new Error(`CSV processing failed: ${error.message}`);
    }
  }

  private async processBatch(
    rows: string[][],
    headers: string[],
    columnMap: Record<string, string>,
    options: ProcessingOptions
  ): Promise<ProcessingResult> {
    
    const recordValidator = createRecordValidator(options.tableName);
    
    const result: ProcessingResult = {
      successCount: 0,
      updateCount: 0, 
      duplicateCount: 0,
      errorCount: 0,
      errors: []
    };

    // Run rows in bounded-concurrency chunks (concurrency 8) rather than
    // strictly serial awaits — trims minutes off multi-thousand-row imports
    // while keeping per-row error attribution.
    type RowOutcome =
      | { kind: 'success' }
      | { kind: 'update' }
      | { kind: 'error'; message: string };

    const settled = await runWithConcurrency(
      rows,
      async (row, rowIndex): Promise<RowOutcome> => {
        // Convert row to object
        const rowObj: Record<string, any> = {};

        headers.forEach((header, index) => {
          const dbColumn = columnMap[header];
          if (dbColumn && row[index] !== undefined) {
            let value = row[index];

            // Normalize LinkedIn URLs (add https:// if missing)
            if (dbColumn === 'linkedin' && value) {
              value = this.normalizeLinkedInUrl(value);
            }

            // Apply date formatting if needed
            const processedValue = DateFormatUtils.processFieldForImport(dbColumn, value);
            rowObj[dbColumn] = processedValue;
          }
        });

        // Normalize country and auto-populate region for accounts
        if (options.tableName === 'accounts') {
          if (rowObj.country) {
            rowObj.country = normalizeCountryName(rowObj.country) || rowObj.country;
          }
          if (rowObj.country && !rowObj.region) {
            rowObj.region = getRegionForCountry(rowObj.country);
          }
          // Enum guardrail: normalize status to the four allowed values.
          if (rowObj.status != null && String(rowObj.status).trim() !== '') {
            const allowed = ['New', 'Working', 'Qualified', 'Inactive'];
            const raw = String(rowObj.status).trim().toLowerCase();
            const match = allowed.find((v) => v.toLowerCase() === raw);
            if (match) {
              rowObj.status = match;
            } else {
              return {
                kind: 'error',
                message: `Row ${rowIndex + 1}: invalid status "${rowObj.status}". Allowed: ${allowed.join(', ')}.`,
              };
            }
          }
        }

        // Resolve user reference fields (convert text names to UUIDs)
        this.resolveUserFields(rowObj, options.userId);

        // Validate record
        const isValid = recordValidator(rowObj);
        if (!isValid) {
          const missingFields = this.getMissingFields(rowObj, options.tableName);
          return {
            kind: 'error',
            message: `Row ${rowIndex + 1}: Validation failed. Missing required: ${missingFields.join(', ')}`,
          };
        }

        // Match an existing record by ID only. A name collision without an ID
        // is treated as a duplicate-conflict error rather than a silent
        // overwrite.
        let existingRecord: { id: string } | null = null;
        if (rowObj.id && isValidUUID(rowObj.id)) {
          const { data: existing } = await supabase
            .from(options.tableName as any)
            .select('id')
            .eq('id', rowObj.id)
            .single();
          existingRecord = (existing as { id: string } | null) ?? null;
        } else if (rowObj.id && !isValidUUID(rowObj.id)) {
          delete rowObj.id;
        }

        if (!existingRecord && options.tableName === 'accounts' && rowObj.account_name) {
          const { data: existingByName } = await supabase
            .from('accounts')
            .select('id')
            .eq('account_name', rowObj.account_name)
            .limit(1)
            .maybeSingle();
          if (existingByName) {
            return {
              kind: 'error',
              message: `Row ${rowIndex + 1}: An account named "${rowObj.account_name}" already exists. Include its id column to update it, or rename the CSV row.`,
            };
          }
        }

        if (existingRecord) {
          const updateData = { ...rowObj };
          updateData.modified_by = options.userId;
          updateData.modified_time = new Date().toISOString();
          delete updateData.id;

          const { error: updateError } = await supabase
            .from(options.tableName as any)
            .update(updateData)
            .eq('id', existingRecord.id);

          if (updateError) {
            return { kind: 'error', message: `Row ${rowIndex + 1}: Update failed - ${updateError.message}` };
          }
          return { kind: 'update' };
        }

        const insertData = { ...rowObj };
        insertData.created_by = options.userId;
        insertData.modified_by = options.userId;
        if (!insertData.id || !isValidUUID(insertData.id)) {
          delete insertData.id;
        }

        const { error: insertError } = await supabase
          .from(options.tableName as any)
          .insert([insertData]);

        if (insertError) {
          let errorMsg = insertError.message;
          if (insertError.message.includes('uuid')) {
            errorMsg = 'Invalid UUID format in record';
          } else if (insertError.message.includes('violates')) {
            errorMsg = `Constraint violation: ${insertError.message}`;
          }
          return { kind: 'error', message: `Row ${rowIndex + 1}: Insert failed - ${errorMsg}` };
        }
        return { kind: 'success' };
      },
      { concurrency: 8 }
    );

    for (const s of settled) {
      if (s.ok === false) {
        result.errorCount++;
        result.errors.push(`Row processing error - ${s.error.message}`);
        continue;
      }
      const v = s.value;
      switch (v.kind) {
        case 'success': result.successCount++; break;
        case 'update': result.updateCount++; break;
        case 'error':
          result.errorCount++;
          result.errors.push(v.message);
          break;
      }
    }


    return result;
  }

  /**
   * Get list of missing required fields for error messages
   */
  private getMissingFields(record: Record<string, any>, tableName: string): string[] {
    const requiredFields: Record<string, string[]> = {
      accounts: ['account_name'],
      contacts: ['contact_name'],
      deals: ['deal_name', 'stage']
    };
    
    const required = requiredFields[tableName] || [];
    return required.filter(field => !record[field] || String(record[field]).trim() === '');
  }

  /**
   * Resolve user reference fields from text names to UUIDs
   */
  private resolveUserFields(rowObj: Record<string, any>, fallbackUserId: string): void {
    if (!this.userResolver) return;

    const userFields = ['contact_owner', 'created_by', 'modified_by', 'lead_owner', 'assigned_to', 'account_owner'];
    
    for (const field of userFields) {
      if (rowObj[field] !== undefined && rowObj[field] !== null && rowObj[field] !== '') {
        const originalValue = rowObj[field];
        
        // Skip if already a valid UUID
        if (isValidUUID(originalValue)) {
          continue;
        }
        
        // Resolve text name to UUID
        const resolvedUUID = this.userResolver.resolveUserName(originalValue, fallbackUserId);
        
        if (resolvedUUID !== fallbackUserId) {
          this.userResolutionStats.resolved++;
          console.log(`User resolved: "${originalValue}" -> ${resolvedUUID}`);
        } else if (originalValue && originalValue.trim() !== '') {
          this.userResolutionStats.fallback++;
          console.log(`User fallback used for: "${originalValue}"`);
        }
        
        rowObj[field] = resolvedUUID;
      }
    }
  }

  /**
   * Normalize LinkedIn URLs by adding https:// prefix if missing
   */
  private normalizeLinkedInUrl(url: string): string {
    if (!url) return '';
    const trimmed = url.trim();
    
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    
    return `https://${trimmed}`;
  }
}
