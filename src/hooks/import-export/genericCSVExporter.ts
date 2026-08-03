
import { downloadCSV } from '@/utils/csvUtils';
import { DateFormatUtils } from '@/utils/dateFormatUtils';
import { UserNameUtils } from '@/utils/userNameUtils';

export class GenericCSVExporter {
  
  async exportToCSV(data: any[], filename: string, fieldsOrder: string[]) {
    console.log(`GenericCSVExporter: Starting export of ${data.length} records`);
    
    if (!data || data.length === 0) {
      throw new Error('No data to export');
    }

    // Fetch user display names for all user fields
    const userIds = UserNameUtils.extractUserIds(data);
    const userNameMap = await UserNameUtils.fetchUserDisplayNames(userIds);
    console.log('GenericCSVExporter: Fetched display names for', Object.keys(userNameMap).length, 'users');

    // Create CSV header row - exact field order
    const headers = fieldsOrder;

    // Convert data to CSV rows with proper formatting
    const csvRows = data.map((record) => {
      return fieldsOrder.map(field => {
        let value = record[field];
        
        // Format ID (shortened)
        if (field === 'id' && value) {
          return UserNameUtils.formatIdForExport(value);
        }
        
        // Convert UUID to display name for user fields
        if (UserNameUtils.isUserField(field) && value) {
          return userNameMap[value] || '';
        }
        
        // Format datetime fields
        if (UserNameUtils.isDateTimeField(field) && value) {
          return UserNameUtils.formatDateTimeForExport(value);
        }
        
        // Use existing date formatting for date-only fields
        return DateFormatUtils.processFieldForExport(field, value);
      });
    });

    // Combine headers and data
    const allRows = [headers, ...csvRows];

    // Convert to CSV string with proper escaping
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


    console.log(`GenericCSVExporter: CSV content generated, length:`, csvContent.length);
    
    const success = downloadCSV(csvContent, filename);
    
    if (!success) {
      throw new Error('Failed to download CSV file');
    }
    
    console.log(`GenericCSVExporter: Export completed successfully`);
  }
}
