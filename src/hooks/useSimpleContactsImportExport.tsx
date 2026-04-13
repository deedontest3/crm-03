import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { GenericCSVProcessor } from './import-export/genericCSVProcessor';
import { GenericCSVExporter } from './import-export/genericCSVExporter';
import { getExportFilename } from '@/utils/exportUtils';
import { fetchAllRecords } from '@/utils/supabasePagination';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';

// Contacts field order (aligned with Zoho CRM standard fields)
const CONTACTS_EXPORT_FIELDS = [
  'id', 'contact_name', 'company_name', 'position', 'email', 'phone_no',
  'linkedin', 'website', 'contact_source', 'industry', 'region',
  'description', 'contact_owner', 'created_by', 'modified_by',
  'created_time', 'modified_time', 'last_activity_time'
];

export const useSimpleContactsImportExport = (onRefresh: () => void) => {
  const { user } = useAuth();
  const [isImporting, setIsImporting] = useState(false);
  const { logSecurityEvent } = useSecurityAudit();

  const handleImport = async (file: File) => {
    console.log('=== CONTACTS IMPORT STARTED ===');
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
    
    const importToast = toast({
      title: "Importing Contacts...",
      description: "Processing CSV file, please wait...",
    });
    
    try {
      console.log('Reading file content...');
      const text = await file.text();
      console.log('File loaded successfully. Content length:', text.length, 'characters');
      
      if (!text || text.trim() === '') {
        throw new Error('CSV file is empty');
      }
      
      const processor = new GenericCSVProcessor();
      
      console.log('Starting CSV processing for contacts table...');
      const result = await processor.processCSV(text, {
        tableName: 'contacts',
        userId: user.id,
        onProgress: (processed, total) => {
          console.log(`Contacts import progress: ${processed}/${total}`);
        }
      });

      console.log('=== IMPORT RESULT ===');
      console.log('Success count:', result.successCount);
      console.log('Update count:', result.updateCount);
      console.log('Error count:', result.errorCount);
      console.log('Errors:', result.errors);

      const { successCount, updateCount, errorCount, errors, userResolutionStats } = result;
      
      importToast.dismiss();
      
      let message = '';
      const parts = [];
      
      if (successCount > 0) parts.push(`${successCount} new contacts imported`);
      if (updateCount > 0) parts.push(`${updateCount} contacts updated`);
      if (errorCount > 0) parts.push(`${errorCount} errors`);
      
      message = parts.length > 0 ? parts.join(', ') : 'No contacts were imported';
      
      if (userResolutionStats && (userResolutionStats.resolved > 0 || userResolutionStats.fallback > 0)) {
        message += ` | Users: ${userResolutionStats.resolved} resolved, ${userResolutionStats.fallback} fallback`;
      }
      
      if (successCount > 0 || updateCount > 0) {
        logSecurityEvent('DATA_IMPORT', 'contacts', undefined, {
          file_name: file.name,
          new_records: successCount,
          updated_records: updateCount,
          errors: errorCount
        });
        
        toast({
          title: "Import Successful",
          description: message,
        });
        
        onRefresh();
        
        window.dispatchEvent(new CustomEvent('contacts-data-updated', {
          detail: { successCount, updateCount, source: 'csv-import' }
        }));
      } else if (errorCount > 0) {
        const errorSample = errors.slice(0, 3).join('; ');
        toast({
          title: "Import Failed",
          description: `${message}. ${errorSample}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Import Warning",
          description: "No contacts were found in the CSV file. Please check the file format and headers.",
          variant: "destructive",
        });
      }

      if (errors.length > 0) {
        console.error('Import errors:', errors);
      }

    } catch (error: any) {
      console.error('=== IMPORT ERROR ===');
      console.error('Error:', error);
      
      toast({
        title: "Import Error",
        description: error?.message || "Failed to import contacts. Please check the console for details.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      console.log('=== CONTACTS IMPORT COMPLETED ===');
    }
  };

  const handleExport = async () => {
    console.log('=== CONTACTS EXPORT STARTED ===');
    
    try {
      const contacts = await fetchAllRecords('contacts', 'created_time', false);

      if (!contacts || contacts.length === 0) {
        toast({
          title: "No Data",
          description: "No contacts to export",
          variant: "destructive",
        });
        return;
      }

      console.log('Exporting', contacts.length, 'contacts');
      
      const filename = getExportFilename('contacts', 'all');
      const exporter = new GenericCSVExporter();
      await exporter.exportToCSV(contacts, filename, CONTACTS_EXPORT_FIELDS);

      logSecurityEvent('DATA_EXPORT', 'contacts', undefined, {
        record_count: contacts.length
      });
      
      toast({
        title: "Export Successful",
        description: `${contacts.length} contacts exported`,
      });

    } catch (error: any) {
      console.error('Export error:', error);
      toast({
        title: "Export Error",
        description: error.message || "Failed to export contacts",
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
