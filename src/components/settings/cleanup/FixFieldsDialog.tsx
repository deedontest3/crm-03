import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CleanupFinding } from '@/hooks/useDatabaseCleanup';

interface Props {
  open: boolean;
  finding: CleanupFinding | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, any>) => Promise<void>;
}

// Typed-input metadata for known fields. Anything not listed falls back to text.
type FieldType = 'text' | 'date' | 'enum' | 'email' | 'phone';
interface FieldSpec { type: FieldType; options?: string[]; placeholder?: string; }

const FIELD_SPECS: Record<string, FieldSpec> = {
  industry:    { type: 'enum', options: ['Automotive', 'Aerospace', 'Energy', 'Healthcare', 'Manufacturing', 'Retail', 'Software', 'Telecom', 'Other'] },
  region:      { type: 'enum', options: ['North America', 'Europe', 'APAC', 'LATAM', 'MEA'] },
  country:     { type: 'text', placeholder: 'e.g. Germany' },
  email:       { type: 'email', placeholder: 'name@example.com' },
  phone_no:    { type: 'phone', placeholder: '+1 555 555 0123' },
  due_date:    { type: 'date' },
  expected_closing_date: { type: 'date' },
  start_date:  { type: 'date' },
  end_date:    { type: 'date' },
  stage:       { type: 'enum', options: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost', 'Dropped'] },
  status:      { type: 'enum', options: ['Open', 'In Progress', 'Completed', 'Cancelled'] },
};

function validate(field: string, value: string): string | null {
  const spec = FIELD_SPECS[field];
  // Allow blanks — let the user fix only the fields they care about.
  if (!value.trim()) return null;
  if (!spec) return null;
  if (spec.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Invalid email';
  if (spec.type === 'phone' && !/^[+\d][\d\s().-]{5,}$/.test(value)) return 'Invalid phone number';
  if (spec.type === 'date' && Number.isNaN(Date.parse(value))) return 'Invalid date';
  if (spec.type === 'enum' && spec.options && !spec.options.includes(value)) return 'Pick a value';
  return null;
}

export default function FixFieldsDialog({ open, finding, loading, onOpenChange, onSave }: Props) {
  const fields = useMemo(() => finding?.missingFields ?? [], [finding]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) { setValues({}); setTouched({}); }
  }, [open, finding?.id]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const f of fields) {
      const err = validate(f, values[f] ?? '');
      if (err) e[f] = err;
    }
    return e;
  }, [fields, values]);

  const hasErrors = Object.keys(errors).length > 0;

  const handleSave = async () => {
    setTouched(Object.fromEntries(fields.map((f) => [f, true])));
    if (hasErrors) return;
    // Only patch fields the user actually entered a value for.
    const payload: Record<string, any> = {};
    for (const f of fields) {
      const v = (values[f] ?? '').trim();
      if (v) payload[f] = v;
    }
    if (Object.keys(payload).length === 0) return;
    await onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix missing fields</DialogTitle>
          <DialogDescription>{finding?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {fields.map((f) => {
            const spec = FIELD_SPECS[f] ?? { type: 'text' as FieldType };
            const error = touched[f] && errors[f];
            return (
              <div key={f} className="space-y-1">
                <Label htmlFor={`fix-${f}`}>{f.replace(/_/g, ' ')}</Label>
                {spec.type === 'enum' && spec.options ? (
                  <Select
                    value={values[f] ?? ''}
                    onValueChange={(v) => { setValues((s) => ({ ...s, [f]: v })); setTouched((t) => ({ ...t, [f]: true })); }}
                  >
                    <SelectTrigger id={`fix-${f}`}><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {spec.options.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`fix-${f}`}
                    type={spec.type === 'date' ? 'date' : spec.type === 'email' ? 'email' : 'text'}
                    value={values[f] ?? ''}
                    placeholder={spec.placeholder ?? `Enter ${f}`}
                    onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                    onBlur={() => setTouched((t) => ({ ...t, [f]: true }))}
                    aria-invalid={!!error}
                  />
                )}
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
            );
          })}
          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">No editable missing fields.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || fields.length === 0 || hasErrors}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
