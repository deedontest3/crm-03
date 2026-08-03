import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { GenericCSVProcessor } from './import-export/genericCSVProcessor';
import { GenericCSVExporter } from './import-export/genericCSVExporter';
import { getExportFilename } from '@/utils/exportUtils';
import { fetchAllRecords } from '@/utils/supabasePagination';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';

// Accounts field order for export
const ACCOUNTS_EXPORT_FIELDS = [
  'id', 'account_name', 'phone', 'website',
  'industry', 'company_type', 'region', 'country', 'status',
  'description', 'account_owner', 'created_by', 'modified_by',
  'created_time', 'modified_time', 'last_activity_time', 'currency'
];

export const useSimpleAccountsImportExport = (onRefresh: () => void) => {
  const { user } = useAuth();
  const [isImporting, setIsImporting] = useState(false);
  const { logSecurityEvent } = useSecurityAudit();

  const handleImport = async (file: File) => {
    console.log('=== ACCOUNTS IMPORT STARTED ===');
    console.log('File:', file.name, 'Size:', file.size, 'bytes');
    
    if (!user?.id) {
      console.error('Import failed: User not authenticated');
      toast({
        title: "Error",
        description: "User not authenticated. Please log in and try again.",
        variant: "destructive",
      });
      return;
    }

    if (!file) {
      console.error('Import failed: No file provided');
      toast({
        title: "Error",
        description: "No file selected for import.",
        variant: "destructive",
      });
      return;
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      console.error('Import failed: Invalid file type');
      toast({
        title: "Error",
        description: "Please select a valid CSV file.",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    
    // Show initial importing toast
    const importToast = toast({
      title: "Importing Accounts...",
      description: "Processing CSV file, please wait...",
    });
    
    try {
      // Read file content with explicit encoding handling. Strip a leading
      // UTF-8 BOM so it doesn't sneak into the first CSV header cell, and warn
      // when the file appears to be non-UTF8 (Excel Windows-1252 exports).
      console.log('Reading file content...');
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      if (text.includes('\ufffd')) {
        console.warn('Import: file contained non-UTF-8 bytes — special characters may be corrupted.');
        toast({
          title: "Encoding warning",
          description: "The CSV had non-UTF-8 characters. Re-save it as UTF-8 for best results.",
        });
      }
      console.log('File loaded successfully. Content length:', text.length, 'characters');

      if (!text || text.trim() === '') {
        throw new Error('CSV file is empty');
      }

      // Log first 500 chars for debugging
      console.log('CSV preview (first 500 chars):', text.substring(0, 500));

      const processor = new GenericCSVProcessor();

      console.log('Starting CSV processing for accounts table...');
      let lastProgressUpdate = 0;
      const result = await processor.processCSV(text, {
        tableName: 'accounts',
        userId: user.id,
        onProgress: (processed, total) => {
          const now = Date.now();
          if (now - lastProgressUpdate > 250 || processed === total) {
            lastProgressUpdate = now;
            importToast.update({
              id: importToast.id,
              title: "Importing Accounts...",
              description: `Processed ${processed} of ${total}...`,
            } as any);
          }
        },
      });

      console.log('=== IMPORT RESULT ===');
      console.log('Success count:', result.successCount);
      console.log('Update count:', result.updateCount);
      console.log('Error count:', result.errorCount);
      console.log('Errors:', result.errors);
      console.log('User resolution stats:', result.userResolutionStats);

      const { successCount, updateCount, errorCount, errors, userResolutionStats } = result;
      
      // Dismiss the importing toast
      importToast.dismiss();
      
      // Build result message
      let message = '';
      const parts = [];
      
      if (successCount > 0) {
        parts.push(`${successCount} new accounts imported`);
      }
      if (updateCount > 0) {
        parts.push(`${updateCount} accounts updated`);
      }
      if (errorCount > 0) {
        parts.push(`${errorCount} errors`);
      }
      
      if (parts.length > 0) {
        message = parts.join(', ');
      } else {
        message = 'No accounts were imported';
      }
      
      // Add user resolution stats if available
      if (userResolutionStats && (userResolutionStats.resolved > 0 || userResolutionStats.fallback > 0)) {
        message += ` | Users: ${userResolutionStats.resolved} resolved, ${userResolutionStats.fallback} fallback`;
      }
      
      // Show appropriate toast based on result
      if (successCount > 0 || updateCount > 0) {
        logSecurityEvent('DATA_IMPORT', 'accounts', undefined, {
          file_name: file.name,
          new_records: successCount,
          updated_records: updateCount,
          errors: errorCount
        });
        
        toast({
          title: "Import Successful",
          description: message,
        });
        
        console.log('Refreshing accounts table...');
        onRefresh();
        
        // Dispatch event for other components
        window.dispatchEvent(new CustomEvent('accounts-data-updated', {
          detail: { successCount, updateCount, source: 'csv-import' }
        }));
      } else if (errorCount > 0) {
        // All rows failed
        const errorSample = errors.slice(0, 3).join('; ');
        toast({
          title: "Import Failed",
          description: `${message}. ${errorSample}`,
          variant: "destructive",
        });
      } else {
        // No rows processed at all - possibly parsing issue
        toast({
          title: "Import Warning",
          description: "No accounts were found in the CSV file. Please check the file format and headers.",
          variant: "destructive",
        });
      }

      // Log detailed errors to console
      if (errors.length > 0) {
        console.error('Import errors:', errors);
      }

    } catch (error: any) {
      console.error('=== IMPORT ERROR ===');
      console.error('Error:', error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      
      toast({
        title: "Import Error",
        description: error?.message || "Failed to import accounts. Please check the console for details.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      console.log('=== ACCOUNTS IMPORT COMPLETED ===');
    }
  };

  const handleExport = async () => {
    console.log('=== ACCOUNTS EXPORT STARTED ===');
    
    try {
      const accounts = await fetchAllRecords('accounts', 'created_time', false);

      if (!accounts || accounts.length === 0) {
        toast({
          title: "No Data",
          description: "No accounts to export",
          variant: "destructive",
        });
        return;
      }

      // Resolve user UUIDs (account_owner / created_by / modified_by) into
      // human-readable display names for a friendlier CSV export.
      const userIdSet = new Set<string>();
      for (const a of accounts as any[]) {
        if (a.account_owner) userIdSet.add(a.account_owner);
        if (a.created_by) userIdSet.add(a.created_by);
        if (a.modified_by) userIdSet.add(a.modified_by);
      }
      const userIds = Array.from(userIdSet);
      const nameById: Record<string, string> = {};
      if (userIds.length) {
        try {
          const { supabase } = await import('@/integrations/supabase/client');
          const { data: profiles } = await supabase
            .from('profiles_public' as any)
            .select('id, full_name, "Email ID"')
            .in('id', userIds);
          for (const p of (profiles || []) as any[]) {
            const raw = (p.full_name || '').trim();
            const email = p["Email ID"] || '';
            nameById[p.id] = raw && !raw.includes('@') && raw !== email
              ? raw
              : (email ? email.split('@')[0] : p.id);
          }
        } catch (e) {
          console.warn('Failed to resolve user display names for export', e);
        }
      }
      const enriched = (accounts as any[]).map((a) => ({
        ...a,
        account_owner: a.account_owner ? (nameById[a.account_owner] || a.account_owner) : a.account_owner,
        created_by: a.created_by ? (nameById[a.created_by] || a.created_by) : a.created_by,
        modified_by: a.modified_by ? (nameById[a.modified_by] || a.modified_by) : a.modified_by,
      }));

      console.log('Exporting', enriched.length, 'accounts');
      
      const filename = getExportFilename('accounts', 'all');
      const exporter = new GenericCSVExporter();
      await exporter.exportToCSV(enriched, filename, ACCOUNTS_EXPORT_FIELDS);

      logSecurityEvent('DATA_EXPORT', 'accounts', undefined, {
        record_count: enriched.length
      });
      
      toast({
        title: "Export Successful",
        description: `${enriched.length} accounts exported`,
      });

      console.log('=== ACCOUNTS EXPORT COMPLETED ===');

    } catch (error: any) {
      console.error('Export error:', error);
      toast({
        title: "Export Error",
        description: error.message || "Failed to export accounts",
        variant: "destructive",
      });
    }
  };

  return {
    handleImport,
    handleExport,
    isImporting
  };
};
