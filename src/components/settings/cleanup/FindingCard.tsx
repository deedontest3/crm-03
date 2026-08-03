import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, GitMerge, Trash2, Pencil, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import type { CleanupFinding } from '@/hooks/useDatabaseCleanup';

interface Props {
  finding: CleanupFinding;
  acting: boolean;
  onDelete: () => Promise<void>;
  onDismiss: () => void;
  onMerge: () => void;
  onFix: () => void;
}

const severityVariant: Record<string, 'destructive' | 'default' | 'secondary'> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
};

const MODULE_ROUTES: Record<string, string> = {
  accounts: '/accounts',
  contacts: '/contacts',
  deals: '/deals',
  campaigns: '/campaigns',
  action_items: '/action-items',
  notifications: '/notifications',
  settings: '/settings?tab=admin',
};

export default function FindingCard({ finding, acting, onDelete, onDismiss, onMerge, onFix }: Props) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');

  const route = MODULE_ROUTES[finding.module];
  const isAggregate = finding.aggregate === true || finding.recordIds.length === 0;
  const canMerge = !isAggregate && finding.rule === 'duplicate' && finding.recordIds.length > 1;
  const canFix = !isAggregate && finding.rule === 'incomplete' && (finding.missingFields?.length ?? 0) > 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={severityVariant[finding.severity]}>{finding.severity}</Badge>
            <Badge variant="outline" className="capitalize">{finding.rule}</Badge>
            <span className="text-xs text-muted-foreground">{finding.recordIds.length} record(s)</span>
          </div>
          <h4 className="font-medium text-sm truncate">{finding.title}</h4>
          <p className="text-xs text-muted-foreground">{finding.description}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onDismiss} title="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {route && (
          <Button size="sm" variant="outline" onClick={() => navigate(route)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open module
          </Button>
        )}
        {canFix && (
          <Button size="sm" variant="outline" onClick={onFix} disabled={acting}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Fix fields
          </Button>
        )}
        {canMerge && (
          <Button size="sm" variant="outline" onClick={onMerge} disabled={acting}>
            <GitMerge className="h-3.5 w-3.5 mr-1" /> Merge
          </Button>
        )}
        {!isAggregate && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={acting}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {finding.recordIds.length} record(s)?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes from <strong>{finding.table}</strong>. No backup is taken.
                Type <strong>DELETE</strong> to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirm('')}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={confirm !== 'DELETE'}
                onClick={async () => { setConfirm(''); await onDelete(); }}
              >
                Confirm delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        )}
      </div>
    </div>
  );
}
