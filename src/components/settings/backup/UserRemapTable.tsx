import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface UserMappingItem {
  sourceId: string;
  email: string | null;
  targetId: string | null;
}

interface Props {
  mapping: UserMappingItem[];
  userMap: Record<string, string | 'skip' | 'invite'>;
  setUserMap: React.Dispatch<React.SetStateAction<Record<string, string | 'skip' | 'invite'>>>;
}

const UserRemapTable = ({ mapping, userMap, setUserMap }: Props) => {
  if (mapping.length === 0) return null;
  const unmatched = mapping.filter((m) => !m.targetId).length;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium flex items-center gap-2">
        User remap (email-matched)
        {unmatched > 0 && <Badge variant="outline" className="text-[10px]">{unmatched} unmatched</Badge>}
      </div>
      <div className="border rounded max-h-48 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left">Email</th>
              <th className="px-2 py-1 text-left">Source ID</th>
              <th className="px-2 py-1 text-left">Target</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((m) => (
              <tr key={m.sourceId} className="border-t">
                <td className="px-2 py-1">{m.email || <span className="text-muted-foreground">(no email)</span>}</td>
                <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">{m.sourceId.slice(0, 8)}…</td>
                <td className="px-2 py-1">
                  {m.targetId ? (
                    <Badge variant="outline" className="text-[10px]">matched</Badge>
                  ) : (
                    <Select
                      value={userMap[m.sourceId] || 'skip'}
                      onValueChange={(v) => setUserMap((p) => ({ ...p, [m.sourceId]: v as any }))}
                    >
                      <SelectTrigger className="h-6 w-32 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip rows</SelectItem>
                        {m.email && <SelectItem value="invite">Invite by email</SelectItem>}
                      </SelectContent>
                    </Select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserRemapTable;
