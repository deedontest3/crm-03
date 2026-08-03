import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const defaultColumnWidths: Record<string, number> = {
  checkbox: 48,
  account_name: 300,
  linked_contacts: 100,
  linked_deals: 100,
  status: 100,
  company_type: 120,
  industry: 120,
  phone: 120,
  website: 150,
  country: 100,
  region: 80,
  currency: 80,
  created_time: 100,
  account_owner: 130,
  actions: 80,
};

// Trailing-debounce window for persisting width edits. Local state updates
// immediately so the resize handle feels instant; the network write waits
// until the drag settles to avoid dozens of upserts per second.
const PERSIST_DEBOUNCE_MS = 300;

export function useAccountColumnWidths() {
  const { user } = useAuth();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(defaultColumnWidths);
  const [isLoading, setIsLoading] = useState(true);
  const widthsRef = useRef(columnWidths);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { widthsRef.current = columnWidths; }, [columnWidths]);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    const loadPreferences = async () => {
      try {
        const { data } = await supabase
          .from('column_preferences')
          .select('column_widths')
          .eq('user_id', user.id)
          .eq('module', 'accounts_widths')
          .maybeSingle();
        if (cancelled) return;
        if (data?.column_widths) {
          setColumnWidths({ ...defaultColumnWidths, ...(data.column_widths as Record<string, number>) });
        }
      } catch (error) {
        if (!cancelled) console.error('Error loading account column widths:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    loadPreferences();
    return () => { cancelled = true; };
  }, [user]);

  // Flush any pending debounced write on unmount so the last drag width isn't lost.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        // Fire-and-forget — component is unmounting, we no longer care about errors.
        const uid = user?.id;
        const widths = widthsRef.current;
        if (uid) {
          void supabase.from('column_preferences').upsert({
            user_id: uid,
            module: 'accounts_widths',
            column_widths: widths,
          }, { onConflict: 'user_id,module' });
        }
      }
    };
  }, [user]);

  const updateColumnWidth = useCallback((field: string, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [field]: width };
      widthsRef.current = next;
      return next;
    });
    if (!user) return;

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      persistTimerRef.current = null;
      try {
        await supabase.from('column_preferences').upsert({
          user_id: user.id,
          module: 'accounts_widths',
          column_widths: widthsRef.current,
        }, { onConflict: 'user_id,module' });
      } catch (error) {
        console.error('Error saving account column widths:', error);
      }
    }, PERSIST_DEBOUNCE_MS);
  }, [user]);

  return { columnWidths, isLoading, updateColumnWidth, defaultColumnWidths };
}
