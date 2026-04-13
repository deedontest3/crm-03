import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { AuditLog, formatFieldName, formatFieldValue, filterInternalFields, filterNoiseFieldChanges, getRecordName, getModuleName, getActivityLabel, getActivityBadgeColor } from "./auditLogUtils";

interface AuditLogDetailDialogProps {
  log: AuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
}

const badgeColorClasses: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  yellow: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  gray: 'bg-muted text-muted-foreground',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

export const AuditLogDetailDialog = ({ log, open, onOpenChange, userName }: AuditLogDetailDialogProps) => {
  if (!log) return null;

  const recordName = getRecordName(log);
  const module = getModuleName(log);
  const color = getActivityBadgeColor(log.action);

  const renderUpdateDetails = () => {
    const d = log.details;
    if (d?.field_changes) {
      const changes = filterNoiseFieldChanges(d.field_changes);
      const entries = Object.entries(changes);
      if (entries.length === 0) return <p className="text-sm text-muted-foreground">Only system fields were updated.</p>;

      return (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Field</TableHead>
                <TableHead className="w-[35%]">Previous Value</TableHead>
                <TableHead className="w-[35%]">New Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(([field, change]: [string, any]) => (
                <TableRow key={field}>
                  <TableCell className="font-medium">{formatFieldName(field)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatFieldValue(change.old)}</TableCell>
                  <TableCell className="text-foreground font-medium">{formatFieldValue(change.new)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }

    if (log.action === 'BULK_UPDATE') {
      const titles = d?.update_data?.item_titles || d?.item_titles || [];
      const recordIds = d?.update_data?.record_ids || d?.record_ids || (log.resource_id ? [log.resource_id] : []);
      const status = d?.update_data?.status || d?.status;

      return (
        <div className="space-y-2">
          {titles.length > 0 && (
            <div className="flex flex-col py-1 border-b border-border/50">
              <span className="text-xs text-muted-foreground">Record{titles.length > 1 ? 's' : ''}</span>
              <span className="text-sm font-medium">{titles.join(', ')}</span>
            </div>
          )}
          {status && (
            <div className="flex flex-col py-1 border-b border-border/50">
              <span className="text-xs text-muted-foreground">Updated Status</span>
              <span className="text-sm font-medium">{formatFieldValue(status)}</span>
            </div>
          )}
          {recordIds.length > 0 && (
            <div className="flex flex-col py-1 border-b border-border/50">
              <span className="text-xs text-muted-foreground">Record ID{recordIds.length > 1 ? 's' : ''}</span>
              <span className="text-sm font-medium break-all">{recordIds.join(', ')}</span>
            </div>
          )}
        </div>
      );
    }

    return <p className="text-sm text-muted-foreground">No change details available.</p>;
  };

  const renderCreateDetails = () => {
    const data = log.details?.record_data;
    if (!data) return <p className="text-sm text-muted-foreground">No record data available.</p>;
    const filtered = filterInternalFields(data);
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {Object.entries(filtered).map(([key, value]) => (
          <div key={key} className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">{formatFieldName(key)}</span>
            <span className="text-sm font-medium">{formatFieldValue(value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderDeleteDetails = () => {
    const data = log.details?.deleted_data;
    if (!data) return <p className="text-sm text-muted-foreground">No deleted data available.</p>;
    const filtered = filterInternalFields(data);
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {Object.entries(filtered).map(([key, value]) => (
          <div key={key} className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">{formatFieldName(key)}</span>
            <span className="text-sm font-medium">{formatFieldValue(value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderActivityDetails = () => {
    const d = log.details;
    return (
      <div className="space-y-3">
        {d?.log_type && (
          <div>
            <span className="text-xs text-muted-foreground">Type</span>
            <p className="text-sm font-medium">{d.log_type}</p>
          </div>
        )}
        {d?.message && (
          <div>
            <span className="text-xs text-muted-foreground">Content</span>
            <p className="text-sm mt-1 p-3 bg-muted rounded-md">{d.message}</p>
          </div>
        )}
      </div>
    );
  };

  const renderAuthDetails = () => {
    const d = log.details;
    return (
      <div className="space-y-2">
        {d?.user_email && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{d.user_email}</span>
          </div>
        )}
        {d?.role && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Role</span>
            <span className="text-sm font-medium capitalize">{d.role}</span>
          </div>
        )}
        {d?.user_agent && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Browser / Device</span>
            <span className="text-sm font-medium break-all">{d.user_agent}</span>
          </div>
        )}
        {d?.login_time && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Time</span>
            <span className="text-sm font-medium">{formatFieldValue(d.login_time)}</span>
          </div>
        )}
      </div>
    );
  };

  const renderExportDetails = () => {
    const d = log.details;
    return (
      <div className="space-y-2">
        {d?.module && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Module</span>
            <span className="text-sm font-medium capitalize">{d.module}</span>
          </div>
        )}
        {d?.file_name && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">File Name</span>
            <span className="text-sm font-medium">{d.file_name}</span>
          </div>
        )}
        {d?.record_count !== undefined && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Records</span>
            <span className="text-sm font-medium">{d.record_count}</span>
          </div>
        )}
        {d?.export_scope && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Scope</span>
            <span className="text-sm font-medium capitalize">{d.export_scope}</span>
          </div>
        )}
        {d?.export_type && (
          <div className="flex flex-col py-1 border-b border-border/50">
            <span className="text-xs text-muted-foreground">Format</span>
            <span className="text-sm font-medium">{d.export_type}</span>
          </div>
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch (log.action) {
      case 'UPDATE':
      case 'BULK_UPDATE':
        return renderUpdateDetails();
      case 'CREATE':
      case 'BULK_CREATE':
        return renderCreateDetails();
      case 'DELETE':
      case 'BULK_DELETE':
        return renderDeleteDetails();
      case 'NOTE':
      case 'EMAIL':
      case 'MEETING':
      case 'CALL':
        return renderActivityDetails();
      case 'SESSION_START':
      case 'SESSION_END':
      case 'user_login':
        return renderAuthDetails();
      case 'DATA_EXPORT':
      case 'DATA_IMPORT':
      case 'DATA_IMPORT_SUCCESS':
      case 'DATA_IMPORT_FAILED':
        return renderExportDetails();
      default:
        // Generic fallback - show details as definition list
        if (log.details && typeof log.details === 'object') {
          const filtered = filterInternalFields(log.details);
          if (Object.keys(filtered).length > 0) {
            return (
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {Object.entries(filtered).map(([key, value]) => (
                  <div key={key} className="flex flex-col py-1 border-b border-border/50">
                    <span className="text-xs text-muted-foreground">{formatFieldName(key)}</span>
                    <span className="text-sm font-medium">{formatFieldValue(value)}</span>
                  </div>
                ))}
              </div>
            );
          }
        }
        return <p className="text-sm text-muted-foreground">No additional details available.</p>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Badge className={`${badgeColorClasses[color]} border-0`}>
              {getActivityLabel(log.action)}
            </Badge>
            <DialogTitle className="text-lg">
              {recordName ? `${module}: ${recordName}` : module}
            </DialogTitle>
          </div>
          <DialogDescription className="flex items-center gap-4 pt-1">
            <span>{format(new Date(log.created_at), 'MMM dd, yyyy h:mm:ss a')}</span>
            <span>•</span>
            <span>{userName}</span>
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
};
