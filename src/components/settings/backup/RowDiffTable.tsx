import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronRight, Filter, RotateCcw } from 'lucide-react';
import {
  RowOverrides, ColumnChoice, setColumnChoice, setRowAction, setColumnChoiceForTable,
} from './lib/diffResolution';

type SampleStatus = 'new' | 'updated' | 'volatileOnly' | 'metadataOnly' | 'deleted';

interface RowSample {
  id: string | number;
  status: SampleStatus;
  changedColumns?: Record<string, { live: any; backup: any; volatile?: boolean; metadata?: boolean }>;
  backup?: any;
  live?: any;
}

interface Props {
  table: string;
  rows: RowSample[];
  rowsTruncated?: boolean;
  overrides: RowOverrides;
  setOverrides: React.Dispatch<React.SetStateAction<RowOverrides>>;
}

const STATUS_LABEL: Record<SampleStatus, string> = {
  new: 'NEW',
  updated: 'UPDATED',
  volatileOnly: 'AUTO-ONLY',
  metadataOnly: 'OWNER-ONLY',
  deleted: 'IN LIVE, NOT IN BACKUP',
};

const STATUS_BADGE: Record<SampleStatus, string> = {
  new: 'bg-green-500/10 text-green-700 border-green-500/20',
  updated: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  volatileOnly: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  metadataOnly: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20',
  deleted: 'bg-red-500/10 text-red-700 border-red-500/20',
};

const fmtVal = (v: any) => {
  if (v === null || v === undefined) return <span className="italic text-muted-foreground">null</span>;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return <span>{s.slice(0, 200)}</span>;
};

const RowDiffTable = ({ table, rows, rowsTruncated, overrides, setOverrides }: Props) => {
  const [statusFilter, setStatusFilter] = useState<'all' | SampleStatus | 'non-volatile'>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tableOverrides = overrides[table] || {};

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'non-volatile') {
        if (r.status !== 'updated' && r.status !== 'new' && r.status !== 'deleted') return false;
      } else if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!s) return true;
      if (String(r.id).toLowerCase().includes(s)) return true;
      if (r.changedColumns && Object.keys(r.changedColumns).some((c) => c.toLowerCase().includes(s))) return true;
      return false;
    });
  }, [rows, statusFilter, search]);

  const counts = useMemo(() => {
    const c = { all: rows.length, new: 0, updated: 0, volatileOnly: 0, metadataOnly: 0, deleted: 0 };
    for (const r of rows) (c as any)[r.status]++;
    return c;
  }, [rows]);

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const bulkColumn = (col: string, choice: ColumnChoice) => {
    const ids = filtered
      .filter((r) => r.status === 'updated' && r.changedColumns && col in r.changedColumns)
      .map((r) => String(r.id));
    setOverrides((prev) => setColumnChoiceForTable(prev, table, ids, col, choice));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All ({counts.all.toLocaleString()})</SelectItem>
            <SelectItem value="updated" className="text-xs">Updated ({counts.updated.toLocaleString()})</SelectItem>
            <SelectItem value="metadataOnly" className="text-xs">Owner-only ({counts.metadataOnly.toLocaleString()})</SelectItem>
            <SelectItem value="volatileOnly" className="text-xs">Auto-only ({counts.volatileOnly.toLocaleString()})</SelectItem>
            <SelectItem value="new" className="text-xs">New ({counts.new.toLocaleString()})</SelectItem>
            <SelectItem value="deleted" className="text-xs">In live not in backup ({counts.deleted.toLocaleString()})</SelectItem>
            <SelectItem value="non-volatile" className="text-xs">Real changes only</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by id or column"
            className="h-7 w-56 text-xs"
          />
        </div>
        <div className="ml-auto text-[10px] text-muted-foreground">
          Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
          {rowsTruncated && <Badge variant="outline" className="ml-2 text-[10px]">truncated</Badge>}
        </div>
      </div>

      <ScrollArea className="flex-1 pr-2 border rounded">
        {filtered.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No rows match the current filter.</div>
        ) : (
          <div className="divide-y text-xs">
            {filtered.slice(0, 2000).map((r) => {
              const idKey = String(r.id);
              const ov = tableOverrides[idKey] || {};
              const isOpen = expanded.has(idKey);
              const changedCount = r.changedColumns ? Object.keys(r.changedColumns).length : 0;
              const nonVolatileCount = r.changedColumns
                ? Object.values(r.changedColumns).filter((c) => !c.volatile).length
                : 0;
              return (
                <div key={idKey} className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    {(r.status === 'updated' || r.status === 'volatileOnly' || r.status === 'metadataOnly') ? (
                      <button onClick={() => toggleRow(idKey)} className="text-muted-foreground hover:text-foreground">
                        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                    ) : <span className="w-3" />}
                    <Badge className={`text-[10px] ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[280px]">{idKey}</span>
                    {changedCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {nonVolatileCount}/{changedCount} real change{changedCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {(r.status === 'updated' || r.status === 'volatileOnly' || r.status === 'metadataOnly') && (
                        <Button
                          size="sm"
                          variant={ov.action === 'skip' ? 'destructive' : 'outline'}
                          className="h-6 text-[10px]"
                          onClick={() =>
                            setOverrides((prev) => setRowAction(prev, table, idKey, ov.action === 'skip' ? null : 'skip'))
                          }
                        >
                          {ov.action === 'skip' ? 'Will skip' : 'Skip row'}
                        </Button>
                      )}
                      {(ov.action === 'skip' || (ov.columns && Object.keys(ov.columns).length > 0)) && (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                          onClick={() => setOverrides((prev) => {
                            const next = { ...prev, [table]: { ...(prev[table] || {}) } };
                            delete next[table][idKey];
                            return next;
                          })}
                          title="Reset overrides for this row"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {isOpen && r.changedColumns && (
                    <table className="w-full text-[10px] mt-1.5 border">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-1.5 py-1 w-40">Column</th>
                          <th className="text-left px-1.5 py-1">Live (current)</th>
                          <th className="text-left px-1.5 py-1">Backup (new)</th>
                          <th className="text-left px-1.5 py-1 w-56">Choose</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.changedColumns).map(([col, v]) => {
                          const choice: ColumnChoice = (ov.columns?.[col] as ColumnChoice) || 'backup';
                          return (
                            <tr key={col} className="border-t align-top">
                              <td className="px-1.5 py-1 font-mono">
                                {col}
                                {v.volatile && <Badge variant="outline" className="ml-1 text-[9px] py-0">auto</Badge>}
                                {v.metadata && <Badge variant="outline" className="ml-1 text-[9px] py-0">owner</Badge>}
                              </td>
                              <td className="px-1.5 py-1 font-mono text-red-700 break-all">{fmtVal(v.live)}</td>
                              <td className="px-1.5 py-1 font-mono text-green-700 break-all">{fmtVal(v.backup)}</td>
                              <td className="px-1.5 py-1">
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex gap-1 flex-wrap">
                                    {(['backup', 'live', 'null'] as ColumnChoice[]).map((opt) => (
                                      <label key={opt} className="flex items-center gap-1 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`${idKey}-${col}`}
                                          checked={choice === opt}
                                          onChange={() => setOverrides((prev) =>
                                            setColumnChoice(prev, table, idKey, col, opt === 'backup' ? null : opt)
                                          )}
                                          className="h-3 w-3"
                                        />
                                        <span className={opt === 'backup' ? 'text-green-700' : opt === 'live' ? 'text-red-700' : 'text-muted-foreground'}>
                                          {opt === 'backup' ? 'Use backup' : opt === 'live' ? 'Keep live' : 'Set NULL'}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex gap-1">
                                    <button
                                      className="text-[9px] text-muted-foreground hover:text-foreground underline"
                                      onClick={() => bulkColumn(col, 'live')}
                                    >
                                      Keep live for all
                                    </button>
                                    <button
                                      className="text-[9px] text-muted-foreground hover:text-foreground underline"
                                      onClick={() => bulkColumn(col, 'backup')}
                                    >
                                      Use backup for all
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
            {filtered.length > 2000 && (
              <div className="p-2 text-[10px] text-muted-foreground text-center">
                Showing first 2,000 of {filtered.length.toLocaleString()} matched rows. Refine your filter to narrow down.
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default RowDiffTable;
