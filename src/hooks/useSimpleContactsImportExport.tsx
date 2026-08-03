import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { GenericCSVProcessor } from './import-export/genericCSVProcessor';
import { GenericCSVExporter } from './import-export/genericCSVExporter';
import { getExportFilename } from '@/utils/exportUtils';
import { fetchAllRecords } from '@/utils/supabasePagination';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';
import { supabase } from '@/integrations/supabase/client';

// Contacts field order mirrors the live public.contacts schema so exported
// files can be imported again without referencing retired columns.
const CONTACTS_EXPORT_FIELDS = [
  'id', 'contact_name', 'company_name', 'account_id', 'position', 'email',
  'phone_no', 'linkedin', 'website', 'contact_source', 'industry', 'region',
  'description', 'contact_owner', 'created_by', 'modified_by',
  'created_time', 'modified_time', 'last_activity_time'
];

/** Decode a File as text with BOM handling. UTF-8 BOM (EF BB BF), UTF-16 LE/BE
 *  BOM detection so Excel-exported CSVs from non-UTF-8 locales don't corrupt. */
async function readFileAsText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8';
  let sliceFrom = 0;
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    sliceFrom = 3;
  } else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    encoding = 'utf-16le';
    sliceFrom = 2;
  } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    encoding = 'utf-16be';
    sliceFrom = 2;
  }
  const decoder = new TextDecoder(encoding, { fatal: false });
  const text = decoder.decode(buf.slice(sliceFrom));
  if (text.includes('\uFFFD')) {
    console.warn('CSV contained replacement characters — file may not be UTF-8. Re-save as UTF-8 for best results.');
  }
  return text;
}

interface ExportOptions {
  /** Restrict export to these ids (Export selected). Overrides idIn. */
  ids?: string[];
  /** Restrict to a set of contact ids matching current in-app filters (Export filtered). */
  idIn?: string[];
  /** Free-text search over contact_name / company_name / email. */
  searchTerm?: string;
  /** Owner id filter. */
  ownerFilter?: string;
  scopeLabel?: 'all' | 'filtered' | 'selected';
}

export const useSimpleContactsImportExport = (onRefresh: () => void) => {
  const { user } = useAuth();
  const [isImporting, setIsImporting] = useState(false);
  const { logSecurityEvent } = useSecurityAudit();

  const handleImport = async (file: File) => {
    if (!user?.id) {
      toast({ title: "Error", description: "User not authenticated. Please log in and try again.", variant: "destructive" });
      return;
    }
    if (!file) {
      toast({ title: "Error", description: "No file selected for import.", variant: "destructive" });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ title: "Error", description: "Please select a valid CSV file.", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    const importToast = toast({ title: "Importing Contacts...", description: "Processing CSV file, please wait..." });

    try {
      const text = await readFileAsText(file);
      if (!text || text.trim() === '') throw new Error('CSV file is empty');

      const processor = new GenericCSVProcessor();
      const result = await processor.processCSV(text, {
        tableName: 'contacts',
        userId: user.id,
        onProgress: (processed, total) => console.log(`Contacts import progress: ${processed}/${total}`),
      });

      const { successCount, updateCount, errorCount, errors, userResolutionStats } = result;
      importToast.dismiss();

      const parts: string[] = [];
      if (successCount > 0) parts.push(`${successCount} new contacts imported`);
      if (updateCount > 0) parts.push(`${updateCount} contacts updated`);
      if (errorCount > 0) parts.push(`${errorCount} errors`);
      let message = parts.length ? parts.join(', ') : 'No contacts were imported';
      if (userResolutionStats && (userResolutionStats.resolved > 0 || userResolutionStats.fallback > 0)) {
        message += ` | Users: ${userResolutionStats.resolved} resolved, ${userResolutionStats.fallback} fallback`;
      }

      if (successCount > 0 || updateCount > 0) {
        logSecurityEvent('DATA_IMPORT', 'contacts', undefined, {
          file_name: file.name, new_records: successCount, updated_records: updateCount, errors: errorCount,
        });
        toast({ title: "Import Successful", description: message });
        onRefresh();
        window.dispatchEvent(new CustomEvent('contacts-data-updated', {
          detail: { successCount, updateCount, source: 'csv-import' },
        }));
      } else if (errorCount > 0) {
        const errorSample = errors.slice(0, 3).join('; ');
        toast({ title: "Import Failed", description: `${message}. ${errorSample}`, variant: "destructive" });
      } else {
        toast({
          title: "Import Warning",
          description: "No contacts were found in the CSV file. Please check the file format and headers.",
          variant: "destructive",
        });
      }

      if (errors.length > 0) console.error('Import errors:', errors);
    } catch (error: any) {
      console.error('CSV import error:', error);
      toast({
        title: "Import Error",
        description: error?.message || "Failed to import contacts. Please check the console for details.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async (opts: ExportOptions = {}) => {
    try {
      let rows: any[] | null = null;

      if (opts.ids && opts.ids.length) {
        // Export selected — chunked to avoid URL/param limits
        const CHUNK = 300;
        rows = [];
        for (let i = 0; i < opts.ids.length; i += CHUNK) {
          const batch = opts.ids.slice(i, i + CHUNK);
          const { data, error } = await supabase.from('contacts').select('*').in('id', batch);
          if (error) throw error;
          rows.push(...(data || []));
        }
      } else if (opts.idIn || opts.searchTerm || opts.ownerFilter) {
        // Export filtered — page through explicitly so we don't hit the
        // PostgREST 1000-row default cap.
        const PAGE = 1000;
        rows = [];

        const buildQuery = () => {
          let q: any = supabase.from('contacts').select('*').order('created_time', { ascending: false });
          if (opts.ownerFilter && opts.ownerFilter !== 'all') q = q.eq('contact_owner', opts.ownerFilter);
          if (opts.searchTerm) {
            const escaped = opts.searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const t = `"%${escaped}%"`;
            q = q.or(`contact_name.ilike.${t},company_name.ilike.${t},email.ilike.${t},phone_no.ilike.${t}`);
          }
          return q;
        };

        if (opts.idIn) {
          if (opts.idIn.length === 0) { rows = []; }
          else {
            const CHUNK = 300;
            for (let i = 0; i < opts.idIn.length; i += CHUNK) {
              const { data, error } = await buildQuery().in('id', opts.idIn.slice(i, i + CHUNK));
              if (error) throw error;
              rows.push(...(data || []));
            }
          }
        } else {
          let from = 0;
          while (true) {
            const { data, error } = await buildQuery().range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data?.length) break;
            rows.push(...data);
            if (data.length < PAGE) break;
            from += PAGE;
          }
        }
      } else {
        rows = await fetchAllRecords('contacts', 'created_time', false);
      }

      if (!rows || rows.length === 0) {
        toast({ title: "No Data", description: "No contacts to export", variant: "destructive" });
        return;
      }

      const scope = opts.scopeLabel || 'all';
      const filename = getExportFilename('contacts', scope);
      const exporter = new GenericCSVExporter();
      // GenericCSVExporter writes UTF-8 BOM internally where applicable; if not,
      // browsers still open UTF-8 CSVs correctly for our field set.
      await exporter.exportToCSV(rows, filename, CONTACTS_EXPORT_FIELDS);

      logSecurityEvent('DATA_EXPORT', 'contacts', undefined, { record_count: rows.length, scope });
      toast({ title: "Export Successful", description: `${rows.length} contacts exported (${scope})` });
    } catch (error: any) {
      console.error('Export error:', error);
      toast({ title: "Export Error", description: error.message || "Failed to export contacts", variant: "destructive" });
    }
  };

  return { handleImport, handleExport, isImporting };
};
