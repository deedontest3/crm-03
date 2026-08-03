import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";
import { 
  Database, Download, RefreshCw, ShieldAlert,
  Clock, FileJson, CalendarClock, Users,
  Building2, Briefcase, CheckSquare, RotateCcw, Bell
} from "lucide-react";
import { format, addDays } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import AdvancedBackupPanel from "./backup/AdvancedBackupPanel";
import AdvancedRestorePanel from "./backup/AdvancedRestorePanel";
import { Sparkles } from "lucide-react";

interface Backup {
  id: string;
  file_name: string;
  file_path: string;
  size_bytes: number;
  tables_count: number;
  records_count: number;
  backup_type: string;
  module_name: string | null;
  status: string;
  manifest: any;
  created_at: string;
  created_by: string;
}

interface BackupSchedule {
  id?: string;
  frequency: string;
  time_of_day: string;
  is_enabled: boolean;
  backup_scope: string;
  backup_module: string | null;
  next_run_at?: string;
  last_run_at?: string;
}

const MODULES = [
  { id: 'contacts', name: 'Contacts', icon: Users, color: 'text-green-500' },
  { id: 'accounts', name: 'Accounts', icon: Building2, color: 'text-purple-500' },
  { id: 'deals', name: 'Deals (incl. Leads)', icon: Briefcase, color: 'text-orange-500' },
  { id: 'action_items', name: 'Action Items', icon: CheckSquare, color: 'text-cyan-500' },
  { id: 'notifications', name: 'Notifications', icon: Bell, color: 'text-yellow-500' },
];

const LEGACY_MODULE_LABELS: Record<string, string> = {
  leads: 'Leads (Legacy)',
};

const FREQUENCY_MAP: Record<string, number> = {
  daily: 1,
  every_2_days: 2,
  weekly: 7,
};

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  every_2_days: 'Every 2 Days',
  weekly: 'Weekly',
};

const SCOPE_OPTIONS = [
  { value: 'full', label: 'Full System' },
  ...MODULES.map(m => ({ value: m.id, label: m.name })),
];

function computeNextRun(frequency: string, timeOfDay: string): string {
  const days = FREQUENCY_MAP[frequency] || 2;
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  const next = addDays(new Date(), days);
  next.setHours(hours, minutes, 0, 0);
  return next.toISOString();
}

function getBackupLabel(backup: Backup): string {
  if (backup.backup_type === 'pre_restore') return '🛡️ Safety Snapshot';
  if (backup.backup_type === 'module' && backup.module_name) {
    const mod = MODULES.find(m => m.id === backup.module_name);
    if (mod) return mod.name;
    return LEGACY_MODULE_LABELS[backup.module_name] || backup.module_name;
  }
  if (backup.backup_type === 'scheduled') {
    if (backup.module_name) {
      const mod = MODULES.find(m => m.id === backup.module_name);
      if (mod) return `Scheduled · ${mod.name}`;
      return LEGACY_MODULE_LABELS[backup.module_name] || `Scheduled · ${backup.module_name}`;
    }
    return 'Scheduled · Full';
  }
  return 'Full Backup';
}

const BackupRestoreSettings = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingModule, setCreatingModule] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [schedule, setSchedule] = useState<BackupSchedule>({
    frequency: 'every_2_days',
    time_of_day: '00:00',
    is_enabled: false,
    backup_scope: 'full',
    backup_module: null,
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const { isAdminOrAbove, loading: roleLoading } = useUserRole();
  const { user } = useAuth();

  const fetchBackups = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('backups' as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      setBackups((data as any[]) || []);
    } catch (error: any) {
      console.error('Error fetching backups:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('backup_schedules' as any)
        .select('*')
        .limit(1)
        .single();

      if (data && !error) {
        setSchedule({
          id: (data as any).id,
          frequency: (data as any).frequency || 'every_2_days',
          time_of_day: (data as any).time_of_day || '00:00',
          is_enabled: (data as any).is_enabled || false,
          backup_scope: (data as any).backup_scope || 'full',
          backup_module: (data as any).backup_module || null,
          next_run_at: (data as any).next_run_at,
          last_run_at: (data as any).last_run_at,
        });
      }
    } catch {
      console.log('No backup schedule found, using defaults');
    }
  }, []);

  const fetchModuleCounts = useCallback(async () => {
    const tables = ['contacts', 'accounts', 'deals', 'action_items', 'notifications'];
    const results: Record<string, number> = {};
    await Promise.all(tables.map(async (table) => {
      const { count } = await supabase.from(table as any).select('*', { count: 'exact', head: true });
      results[table] = count || 0;
    }));
    setModuleCounts(results);
  }, []);

  useEffect(() => {
    if (!roleLoading && isAdminOrAbove) {
      fetchBackups();
      fetchSchedule();
      fetchModuleCounts();
    } else if (!roleLoading) {
      setLoading(false);
    }
  }, [fetchBackups, fetchSchedule, fetchModuleCounts, isAdminOrAbove, roleLoading]);

  const handleSaveSchedule = async (newSchedule: BackupSchedule) => {
    setSavingSchedule(true);
    try {
      const nextRunAt = newSchedule.is_enabled
        ? computeNextRun(newSchedule.frequency, newSchedule.time_of_day)
        : null;

      const scheduleData: any = {
        frequency: newSchedule.frequency,
        time_of_day: newSchedule.time_of_day,
        is_enabled: newSchedule.is_enabled,
        backup_scope: newSchedule.backup_scope,
        backup_module: newSchedule.backup_scope === 'full' ? null : newSchedule.backup_module,
        created_by: user?.id,
        next_run_at: nextRunAt,
      };

      if (schedule.id) {
        const { error } = await supabase
          .from('backup_schedules' as any)
          .update(scheduleData)
          .eq('id', schedule.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('backup_schedules' as any)
          .insert(scheduleData)
          .select()
          .single();
        if (error) throw error;
        if (data) setSchedule(prev => ({ ...prev, id: (data as any).id }));
      }

      setSchedule(prev => ({ ...prev, next_run_at: nextRunAt || undefined }));
      toast.success(newSchedule.is_enabled ? 'Scheduled backup enabled' : 'Scheduled backup disabled');
    } catch (error: any) {
      console.error('Error saving schedule:', error);
      toast.error('Failed to save backup schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleCreateBackup = async (moduleName?: string) => {
    if (moduleName) {
      setCreatingModule(moduleName);
    } else {
      setCreating(true);
    }
    try {
      const body: any = { backupType: 'manual' };
      if (moduleName) body.moduleName = moduleName;

      const { error } = await supabase.functions.invoke('create-backup', {
        method: 'POST',
        body,
      });
      if (error) throw error;
      toast.success(moduleName ? `${moduleName} backup created` : 'Full backup created successfully');
      await fetchBackups();
      if (moduleName) await fetchModuleCounts();
    } catch (error: any) {
      console.error('Error creating backup:', error);
      toast.error(error.message || 'Failed to create backup');
    } finally {
      setCreating(false);
      setCreatingModule(null);
    }
  };

  const handleDownloadBackup = async (backup: Backup) => {
    try {
      const { data, error } = await supabase.storage
        .from('backups')
        .download(backup.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Download started');
    } catch (error: any) {
      console.error('Error downloading backup:', error);
      toast.error('Failed to download backup');
    }
  };

  const handleRestoreClick = (backup: Backup) => {
    setSelectedBackup(backup);
    setConfirmText('');
    setShowRestoreDialog(true);
  };

  const handleRestoreConfirm = async () => {
    if (!selectedBackup || confirmText !== 'CONFIRM') return;
    setRestoring(selectedBackup.id);
    setShowRestoreDialog(false);
    try {
      const { error } = await supabase.functions.invoke('restore-backup', {
        method: 'POST',
        body: { backupId: selectedBackup.id },
      });
      if (error) throw error;
      toast.success('Restore completed — a safety snapshot was created automatically');
      await Promise.all([fetchBackups(), fetchModuleCounts()]);
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      toast.error(error.message || 'Failed to restore backup');
    } finally {
      setRestoring(null);
      setSelectedBackup(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdminOrAbove) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold">Access Denied</h3>
        <p className="text-sm text-muted-foreground">Only administrators can manage backups.</p>
      </div>
    );
  }

  const selectedScopeLabel = schedule.backup_scope === 'full'
    ? 'Full System'
    : MODULES.find(m => m.id === schedule.backup_module)?.name || 'Full System';

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: standard backup management */}
        <div className="lg:col-span-2 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Full Backup */}
            <Card>
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Full System Backup</p>
                      <p className="text-xs text-muted-foreground">All CRM data & settings</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => handleCreateBackup()} disabled={creating}>
                    {creating ? (
                      <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1.5" />
                    )}
                    {creating ? 'Creating...' : 'Backup Now'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Scheduled Backup */}
            <Card>
              <CardContent className="pt-5 pb-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CalendarClock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Scheduled Backups</p>
                      <p className="text-xs text-muted-foreground">
                        {schedule.is_enabled && schedule.next_run_at
                          ? `Next: ${format(new Date(schedule.next_run_at), 'MMM d, HH:mm')}`
                          : 'Auto-backup on a schedule'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={schedule.is_enabled}
                      onCheckedChange={(checked) => {
                        const newSchedule = { ...schedule, is_enabled: checked };
                        setSchedule(newSchedule);
                        handleSaveSchedule(newSchedule);
                      }}
                    />
                    {savingSchedule && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>

                {schedule.is_enabled && (
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={schedule.backup_scope === 'full' ? 'full' : (schedule.backup_module || 'full')}
                      onValueChange={(value) => {
                        const isModule = value !== 'full';
                        const newSchedule = {
                          ...schedule,
                          backup_scope: isModule ? 'module' : 'full',
                          backup_module: isModule ? value : null,
                        };
                        setSchedule(newSchedule);
                        handleSaveSchedule(newSchedule);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Scope" /></SelectTrigger>
                      <SelectContent>
                        {SCOPE_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={schedule.frequency}
                      onValueChange={(value) => {
                        const newSchedule = { ...schedule, frequency: value };
                        setSchedule(newSchedule);
                        handleSaveSchedule(newSchedule);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={schedule.time_of_day}
                      onValueChange={(value) => {
                        const newSchedule = { ...schedule, time_of_day: value };
                        setSchedule(newSchedule);
                        handleSaveSchedule(newSchedule);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="00:00">12:00 AM</SelectItem>
                        <SelectItem value="06:00">6:00 AM</SelectItem>
                        <SelectItem value="12:00">12:00 PM</SelectItem>
                        <SelectItem value="18:00">6:00 PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Module Backup */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Module Backup</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={fetchModuleCounts}>
                  <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {MODULES.map((module) => {
                  const Icon = module.icon;
                  const isCreating = creatingModule === module.id;
                  return (
                    <Button
                      key={module.id}
                      variant="outline"
                      size="sm"
                      className="h-auto py-2.5 px-3 flex flex-col items-center gap-1"
                      onClick={() => handleCreateBackup(module.id)}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon className={`h-4 w-4 ${module.color}`} />
                      )}
                      <span className="text-xs font-medium">{module.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {moduleCounts[module.id]?.toLocaleString() || 0}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Backup History */}
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Backup History
                </CardTitle>
                <Badge variant="secondary" className="text-xs">{backups.length} / 30</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {backups.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No backups yet</p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-[160px]">Type</TableHead>
                        <TableHead className="text-xs w-[150px]">Date</TableHead>
                        <TableHead className="text-xs w-[100px] text-right">Records</TableHead>
                        <TableHead className="text-xs w-[80px] text-right">Size</TableHead>
                        <TableHead className="text-xs w-[100px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {backups.map((backup) => (
                        <TableRow key={backup.id} className="text-xs">
                          <TableCell className="py-2">
                            <div className="flex items-center gap-1.5">
                              <FileJson className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium">{getBackupLabel(backup)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-muted-foreground">
                            {format(new Date(backup.created_at), 'dd MMM yyyy, HH:mm')}
                          </TableCell>
                          <TableCell className="py-2 text-right text-muted-foreground">
                            {backup.records_count?.toLocaleString() || 0}
                          </TableCell>
                          <TableCell className="py-2 text-right text-muted-foreground">
                            {formatBytes(backup.size_bytes)}
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                onClick={() => handleDownloadBackup(backup)}
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                onClick={() => handleRestoreClick(backup)}
                                disabled={restoring === backup.id}
                                title="Restore"
                              >
                                {restoring === backup.id ? (
                                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Advanced Backup & Restore */}
        <div className="lg:col-span-1">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Advanced Backup &amp; Restore
                <Badge variant="outline" className="text-[10px]">Beta</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Schema-aware backups with compression &amp; checksum. Upload a backup from any
                project to compare structures and choose what to restore per table / column,
                with email-based user remapping.
              </p>
              <div className="space-y-4">
                <AdvancedBackupPanel onCreated={fetchBackups} />
                <AdvancedRestorePanel />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>


      {/* Restore Confirmation Dialog */}
      <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">⚠️ Confirm Restore</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>Restoring from: <strong>{selectedBackup ? getBackupLabel(selectedBackup) : ''}</strong></p>
                <p className="text-xs text-muted-foreground">
                  {selectedBackup ? format(new Date(selectedBackup.created_at), 'dd MMM yyyy, HH:mm') : ''}
                  {' • '}{selectedBackup?.records_count?.toLocaleString()} records
                </p>
                <div className="bg-destructive/10 border border-destructive/20 rounded p-3 text-sm">
                  <p className="font-semibold text-destructive">This will:</p>
                  <ul className="list-disc list-inside mt-1 space-y-0.5 text-xs">
                    <li>Create a safety snapshot of current data first</li>
                    <li>Overwrite current database with backup data</li>
                    <li>Replace existing records in backed-up tables</li>
                  </ul>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Type "CONFIRM" to proceed:</Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CONFIRM"
                    className="h-8"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestoreConfirm}
              disabled={confirmText !== 'CONFIRM'}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Restore Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default BackupRestoreSettings;
