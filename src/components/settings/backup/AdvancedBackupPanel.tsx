import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Download, Database } from 'lucide-react';

const ALL_TABLES = [
  'leads', 'contacts', 'accounts', 'deals', 'action_items',
  'deal_action_items', 'lead_action_items', 'notifications',
  'notification_preferences', 'page_permissions', 'profiles',
  'user_preferences', 'user_roles',
  'saved_filters', 'column_preferences', 'dashboard_preferences',
  'yearly_revenue_targets',
];

const MODULE_OPTIONS = [
  { value: 'contacts', label: 'Contacts' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'deals', label: 'Deals (+ leads)' },
  { value: 'action_items', label: 'Action Items' },
  { value: 'notifications', label: 'Notifications' },
];

interface Props {
  onCreated?: () => void;
}

const AdvancedBackupPanel = ({ onCreated }: Props) => {
  const [scope, setScope] = useState<'full' | 'module' | 'custom'>('full');
  const [moduleName, setModuleName] = useState<string>('contacts');
  const [selectedTables, setSelectedTables] = useState<string[]>(ALL_TABLES);
  const [filterColumn, setFilterColumn] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeAuthUsers, setIncludeAuthUsers] = useState(true);
  const [includeStorage, setIncludeStorage] = useState(false);
  const [compress, setCompress] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggleTable = (t: string) => {
    setSelectedTables((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const filters: Record<string, any> = {};
      if (filterColumn && (filterFrom || filterTo)) {
        const tables = scope === 'custom' ? selectedTables : ALL_TABLES;
        for (const t of tables) {
          filters[t] = { column: filterColumn, from: filterFrom || undefined, to: filterTo || undefined };
        }
      }
      const body: any = {
        scope,
        moduleName: scope === 'module' ? moduleName : null,
        tables: scope === 'custom' ? selectedTables : undefined,
        filters,
        includeSchema, includeAuthUsers, includeStorage, compress,
      };
      const { data, error } = await supabase.functions.invoke('create-advanced-backup', {
        method: 'POST', body,
      });
      if (error) {
        let serverMsg = error.message || 'create-advanced-backup failed';
        try {
          const ctx: any = (error as any).context;
          if (ctx?.clone) {
            try { const b = await ctx.clone().json(); if (b?.error) serverMsg = String(b.error); }
            catch { try { const t = await ctx.clone().text(); if (t) serverMsg = t.slice(0, 500); } catch {} }
          }
        } catch {}
        throw new Error(serverMsg);
      }
      toast.success(`Advanced backup created: ${data?.recordsCount?.toLocaleString() || 0} records`);
      onCreated?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to create advanced backup');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4" /> Advanced Backup
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Scope</Label>
            <Select value={scope} onValueChange={(v: any) => setScope(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full System</SelectItem>
                <SelectItem value="module">Module</SelectItem>
                <SelectItem value="custom">Custom tables</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === 'module' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Module</Label>
              <Select value={moduleName} onValueChange={setModuleName}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODULE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {scope === 'custom' && (
          <div className="space-y-1.5">
            <Label className="text-xs">Tables ({selectedTables.length}/{ALL_TABLES.length})</Label>
            <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-auto border rounded p-2">
              {ALL_TABLES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <Checkbox checked={selectedTables.includes(t)} onCheckedChange={() => toggleTable(t)} />
                  <span className="truncate">{t}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Date filter (optional, applied to tables that have the column)</Label>
          <div className="grid grid-cols-3 gap-2">
            <Select value={filterColumn || 'none'} onValueChange={(v) => setFilterColumn(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Column" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No filter</SelectItem>
                <SelectItem value="created_at">created_at</SelectItem>
                <SelectItem value="updated_at">updated_at</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-8 text-xs" />
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-between gap-2 text-xs rounded border px-3 py-2">
            <span>Include schema snapshot</span>
            <Switch checked={includeSchema} onCheckedChange={setIncludeSchema} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs rounded border px-3 py-2">
            <span>Include auth users (email/id)</span>
            <Switch checked={includeAuthUsers} onCheckedChange={setIncludeAuthUsers} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs rounded border px-3 py-2">
            <span>Include storage object metadata</span>
            <Switch checked={includeStorage} onCheckedChange={setIncludeStorage} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs rounded border px-3 py-2">
            <span>Gzip compress + SHA-256</span>
            <Switch checked={compress} onCheckedChange={setCompress} />
          </label>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleCreate} disabled={busy}>
            {busy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            {busy ? 'Creating...' : 'Create Advanced Backup'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default AdvancedBackupPanel;
