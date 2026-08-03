
// CSV utility functions for import/export

export interface ContactCSVRow {
  'id': string;
  'contact_name': string;
  'company_name': string;
  'position': string;
  'email': string;
  'phone_no': string;
  'linkedin': string;
  'website': string;
  'contact_source': string;
  'industry': string;
  'country': string;
  'description': string;
  'contact_owner': string;
  'created_by': string;
  'modified_by': string;
  'created_time': string;
  'modified_time': string;
}

export const exportContactsToCSV = (contacts: any[]) => {
  console.log('exportContactsToCSV called with:', contacts.length, 'contacts');
  
  if (!contacts || contacts.length === 0) {
    throw new Error('No contacts to export');
  }

  // Define headers in the exact sequence from the Supabase table
  const headers = [
    'id',
    'contact_name',
    'company_name',
    'position',
    'email',
    'phone_no',
    'linkedin',
    'website',
    'contact_source',
    'industry',
    'country',
    'description',
    'contact_owner',
    'created_by',
    'modified_by',
    'created_time',
    'modified_time'
  ];

  // Convert contacts to CSV rows
  const csvRows = contacts.map(contact => [
    contact.id || '',
    contact.contact_name || '',
    contact.company_name || '',
    contact.position || '',
    contact.email || '',
    contact.phone_no || '',
    contact.linkedin || '',
    contact.website || '',
    contact.contact_source || '',
    contact.industry || '',
    contact.country || '',
    contact.description || '',
    contact.contact_owner || '',
    contact.created_by || '',
    contact.modified_by || '',
    contact.created_time || '',
    contact.modified_time || ''
  ]);

  // Combine headers and data
  const allRows = [headers, ...csvRows];

  // Convert to CSV string
  const csvContent = allRows
    .map(row =>
      row.map(field => {
        let str = String(field || '');
        // Neutralize CSV formula-injection (CWE-1236) before delimiter escaping.
        const first = str.charAt(0);
        if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
          str = `'${str}`;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    )
    .join('\n');


  console.log('CSV content generated, length:', csvContent.length);
  return csvContent;
};

export const downloadCSV = (csvContent: string, filename: string) => {
  console.log('downloadCSV called with filename:', filename);
  console.log('CSV content length:', csvContent.length);
  
  try {
    // Create blob with UTF-8 BOM for better Excel compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { 
      type: 'text/csv;charset=utf-8;' 
    });
    
    console.log('Blob created, size:', blob.size);

    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      console.error('Not in browser environment');
      return false;
    }

    // For modern browsers, use the download attribute
    if (window.navigator && (window.navigator as any).msSaveOrOpenBlob) {
      // IE specific method
      (window.navigator as any).msSaveOrOpenBlob(blob, filename);
      console.log('IE download method used');
      return true;
    }

    // Standard method for other browsers
    const url = window.URL.createObjectURL(blob);
    console.log('Blob URL created:', url);
    
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    
    // Add to DOM, click, then remove
    document.body.appendChild(link);
    console.log('Link added to DOM, triggering click...');
    
    // Force the download
    link.click();
    
    // Small delay before cleanup to ensure download starts
    setTimeout(() => {
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      console.log('Cleanup completed');
    }, 100);
    
    console.log('Download initiated successfully');
    return true;
    
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
};

// NOTE: an earlier RFC4180 CSV parser (`parseCSVFile` + local `parseCSVLine`)
// lived here with zero call sites. It also `.trim()`'d each line before
// parsing, which breaks multiline quoted fields. Removed — the real parser
// lives in `src/utils/csvParser.ts`. Do not reintroduce a second one.

