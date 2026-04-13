import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ModuleType } from '@/hooks/useActionItems';

export interface ModuleRecord {
  id: string;
  name: string;
}

export function useModuleRecords(moduleType: ModuleType | null) {
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['module_records', moduleType],
    queryFn: async () => {
      if (!moduleType) return [];

      let query;
      let nameField: string;

      switch (moduleType) {
        case 'accounts':
          query = supabase.from('accounts').select('id, account_name').order('account_name');
          nameField = 'account_name';
          break;
        case 'contacts':
          query = supabase.from('contacts').select('id, contact_name').order('contact_name');
          nameField = 'contact_name';
          break;
        case 'deals':
          query = supabase.from('deals').select('id, deal_name').order('deal_name');
          nameField = 'deal_name';
          break;
        default:
          return [];
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((record: any) => ({
        id: record.id,
        name: record[nameField] || 'Unnamed',
      }));
    },
    enabled: !!moduleType,
  });

  return { records, isLoading };
}

// Hook to get a single record name by module type and id
export function useModuleRecordName(moduleType: string | null, moduleId: string | null) {
  const { data: recordName, isLoading } = useQuery({
    queryKey: ['module_record_name', moduleType, moduleId],
    queryFn: async () => {
      if (!moduleType || !moduleId) return null;

      let query;
      let nameField: string;

      switch (moduleType) {
        case 'accounts':
          query = supabase.from('accounts').select('account_name').eq('id', moduleId).single();
          nameField = 'account_name';
          break;
        case 'contacts':
          query = supabase.from('contacts').select('contact_name').eq('id', moduleId).single();
          nameField = 'contact_name';
          break;
        case 'deals':
          query = supabase.from('deals').select('deal_name').eq('id', moduleId).single();
          nameField = 'deal_name';
          break;
        default:
          return null;
      }

      const { data, error } = await query;
      if (error) return null;

      return data ? (data as any)[nameField] : null;
    },
    enabled: !!moduleType && !!moduleId,
  });

  return { recordName, isLoading };
}

// Hook to get multiple record names at once (for table display)
export function useModuleRecordNames(items: Array<{ module_type: string; module_id: string | null }>) {
  const { data: recordNames = {}, isLoading } = useQuery({
    queryKey: ['module_record_names', items.map(i => `${i.module_type}:${i.module_id}`).join(',')],
    queryFn: async () => {
      const names: Record<string, string> = {};
      
      // Group items by module type
      const accountIds = items.filter(i => i.module_type === 'accounts' && i.module_id).map(i => i.module_id!);
      const contactIds = items.filter(i => i.module_type === 'contacts' && i.module_id).map(i => i.module_id!);
      const dealIds = items.filter(i => i.module_type === 'deals' && i.module_id).map(i => i.module_id!);
      const campaignIds = items.filter(i => i.module_type === 'campaigns' && i.module_id).map(i => i.module_id!);

      const promises = [];

      if (accountIds.length > 0) {
        promises.push(
          supabase.from('accounts').select('id, account_name').in('id', accountIds)
            .then(({ data }) => {
              (data || []).forEach((a: any) => {
                names[`accounts:${a.id}`] = a.account_name;
              });
            })
        );
      }

      if (contactIds.length > 0) {
        promises.push(
          supabase.from('contacts').select('id, contact_name').in('id', contactIds)
            .then(({ data }) => {
              (data || []).forEach((c: any) => {
                names[`contacts:${c.id}`] = c.contact_name;
              });
            })
        );
      }

      if (dealIds.length > 0) {
        promises.push(
          supabase.from('deals').select('id, deal_name').in('id', dealIds)
            .then(({ data }) => {
              (data || []).forEach((d: any) => {
                names[`deals:${d.id}`] = d.deal_name;
              });
            })
        );
      }

      if (campaignIds.length > 0) {
        promises.push(
          supabase.from('campaigns').select('id, campaign_name').in('id', campaignIds)
            .then(({ data }) => {
              (data || []).forEach((c: any) => {
                names[`campaigns:${c.id}`] = c.campaign_name;
              });
            })
        );
      }

      await Promise.all(promises);
      return names;
    },
    enabled: items.length > 0 && items.some(i => i.module_id),
  });

  const getRecordName = (moduleType: string, moduleId: string | null): string | null => {
    if (!moduleId) return null;
    return recordNames[`${moduleType}:${moduleId}`] || null;
  };

  return { recordNames, getRecordName, isLoading };
}
