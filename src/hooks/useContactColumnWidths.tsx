import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const defaultColumnWidths: Record<string, number> = {
  checkbox: 48,
  contact_name: 200,
  linked_deals: 90,
  company_name: 180,
  position: 120,
  email: 180,
  phone_no: 120,
  region: 100,
  contact_owner: 130,
  industry: 120,
  contact_source: 100,
  last_activity_time: 120,
  actions: 80,
};

export function useContactColumnWidths() {
  const { user } = useAuth();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(defaultColumnWidths);
  const [isLoading, setIsLoading] = useState(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestWidthsRef = useRef<Record<string, number>>(defaultColumnWidths);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('column_preferences')
          .select('column_widths')
          .eq('user_id', user.id)
          .eq('module', 'contacts_widths')
          .maybeSingle();
        if (cancelled) return;
        if (data?.column_widths) {
          const merged = { ...defaultColumnWidths, ...(data.column_widths as Record<string, number>) };
          setColumnWidths(merged);
          latestWidthsRef.current = merged;
        }
      } catch (error) {
        if (!cancelled) console.error('Error loading contact column widths:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);

  const updateColumnWidth = useCallback((field: string, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [field]: width };
      latestWidthsRef.current = next;
      return next;
    });
    if (!user) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      try {
        await supabase.from('column_preferences').upsert({
          user_id: user.id,
          module: 'contacts_widths',
          column_widths: latestWidthsRef.current,
        }, { onConflict: 'user_id,module' });
      } catch (error) {
        console.error('Error saving contact column widths:', error);
      }
    }, 250);
  }, [user]);

  return { columnWidths, isLoading, updateColumnWidth, defaultColumnWidths };
}
