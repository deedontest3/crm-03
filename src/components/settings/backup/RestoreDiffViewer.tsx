import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldAlert } from 'lucide-react';

export interface TableDiff {
  table: string;
  inLive: boolean;
  backupRowCount: number;
  liveRowCount: number | null;
  matching: string[];
  extraInFile: string[];
  missingInFile: string[];
  typeMismatches: Array<{ column: string; live: string; backup: string }>;
}

export type Mode = 'replace' | 'merge-upsert' | 'append-only' | 'skip';

interface Props {
  tableDiffs: TableDiff[];
  enumDiffs: Array<{ name: string; missingValues: string[]; extraValues: string[] }>;
  modes: Record<string, Mode>;
  setModes: React.Dispatch<React.SetStateAction<Record<string, Mode>>>;
  includeCols: Record<string, Set<string>>;
  setIncludeCols: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>;
}

const RestoreDiffViewer = ({ tableDiffs, enumDiffs, modes, setModes, includeCols, setIncludeCols }: Props) => {
  return (
    <>
      {enumDiffs.length > 0 && (
        <div className="text-xs border border-amber-500/30 bg-amber-500/5 rounded p-2">
          <div className="font-medium flex items-center gap-1.5 text-amber-700">
            <ShieldAlert className="h-3.5 w-3.5" /> Enum mismatches ({enumDiffs.length})
          </div>
          <ul className="mt-1 space-y-0.5">
            {enumDiffs.slice(0, 5).map((e) => (
              <li key={e.name}>
                <span className="font-mono">{e.name}</span>
                {e.missingValues.length > 0 && <> · missing in live: {e.missingValues.join(', ')}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Accordion type="multiple" className="border rounded">
        {tableDiffs.map((t) => (
          <AccordionItem key={t.table} value={t.table}>
            <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
              <div className="flex items-center gap-2 flex-1">
                <span className="font-mono font-medium">{t.table}</span>
                {!t.inLive && <Badge variant="destructive" className="text-[10px]">missing in live</Badge>}
                {t.extraInFile.length > 0 && <Badge variant="outline" className="text-[10px]">{t.extraInFile.length} extra cols</Badge>}
                {t.missingInFile.length > 0 && <Badge variant="outline" className="text-[10px]">{t.missingInFile.length} new cols</Badge>}
                {t.typeMismatches.length > 0 && <Badge variant="destructive" className="text-[10px]">{t.typeMismatches.length} type</Badge>}
                <span className="ml-auto text-muted-foreground">
                  {t.backupRowCount.toLocaleString()} → {t.liveRowCount?.toLocaleString() ?? '?'} rows
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Mode:</span>
                <Select
                  value={modes[t.table] || 'skip'}
                  onValueChange={(v: Mode) => setModes((prev) => ({ ...prev, [t.table]: v }))}
                  disabled={!t.inLive}
                >
                  <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip</SelectItem>
                    <SelectItem value="merge-upsert">Merge / upsert (by id)</SelectItem>
                    <SelectItem value="append-only">Append only (skip dupes)</SelectItem>
                    <SelectItem value="replace">Replace (delete + insert)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {t.matching.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-1">Columns to restore</div>
                  <div className="grid grid-cols-3 gap-1 max-h-32 overflow-auto border rounded p-1.5">
                    {t.matching.map((c) => {
                      const checked = includeCols[t.table]?.has(c) ?? true;
                      return (
                        <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setIncludeCols((prev) => {
                                const set = new Set(prev[t.table] || []);
                                if (v) set.add(c); else set.delete(c);
                                return { ...prev, [t.table]: set };
                              });
                            }}
                          />
                          <span className="font-mono truncate">{c}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {t.extraInFile.length > 0 && (
                <div className="text-muted-foreground">
                  Dropped (not in live): <span className="font-mono">{t.extraInFile.join(', ')}</span>
                </div>
              )}
              {t.typeMismatches.length > 0 && (
                <div className="text-amber-700">
                  Type mismatches: {t.typeMismatches.map((m) => `${m.column}(${m.backup}→${m.live})`).join(', ')}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
};

export default RestoreDiffViewer;
