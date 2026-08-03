import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Lock, Search, Shield, ShieldCheck, User as UserIcon, Briefcase } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';
import { useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/contexts/PermissionsContext';
import { AppLoader } from "@/components/ui/loader";

interface PagePermission {
  id: string;
  page_name: string;
  description: string | null;
  route: string;
  super_admin_access: boolean;
  admin_access: boolean;
  sales_head_access: boolean;
  user_access: boolean;
}

type ToggleField = 'admin_access' | 'sales_head_access' | 'user_access';

const ROLE_LEGEND = [
  {
    role: 'Super Admin',
    icon: ShieldCheck,
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
    blurb: 'Full access to every page. Only role that can open Administration, manage users, and edit page permissions.',
  },
  {
    role: 'Admin',
    icon: Shield,
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    blurb: 'Power user across CRM modules. Cannot access Administration or change roles.',
  },
  {
    role: 'Sales Head',
    icon: Briefcase,
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    blurb: 'Manages sales data across Dashboard, Accounts, Contacts, Deals, Campaigns and Tasks.',
  },
  {
    role: 'User',
    icon: UserIcon,
    color: 'bg-muted text-muted-foreground border-border',
    blurb: 'Standard user. Views all records, adds new ones, edits only their own.',
  },
];

const PageAccessSettings = () => {
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { logSecurityEvent } = useSecurityAudit();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = usePermissions();

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('page_permissions')
        .select('*')
        .order('page_name');
      if (error) throw error;
      setPermissions((data || []) as unknown as PagePermission[]);
    } catch (error) {
      console.error('Error fetching page permissions:', error);
      toast.error('Failed to load page permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  const handleToggle = async (id: string, field: ToggleField, value: boolean) => {
    if (!isSuperAdmin) {
      toast.error('Only Super Admins can edit page permissions');
      return;
    }
    setUpdating(`${id}-${field}`);
    try {
      const { error } = await supabase
        .from('page_permissions')
        .update({ [field]: value } as any)
        .eq('id', id);
      if (error) throw error;

      const perm = permissions.find((p) => p.id === id);
      setPermissions((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
      logSecurityEvent('SETTINGS_UPDATE', 'page_permissions', id, {
        page_name: perm?.page_name,
        field,
        old_value: !value,
        new_value: value,
      });
      queryClient.invalidateQueries({ queryKey: ['page-permissions'] });
      toast.success('Permission updated');
    } catch (error) {
      console.error('Error updating permission:', error);
      toast.error('Failed to update permission');
    } finally {
      setUpdating(null);
    }
  };

  const filtered = permissions.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.page_name.toLowerCase().includes(q) ||
      p.route.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <AppLoader variant="inline" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Role legend */}
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {ROLE_LEGEND.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.role} className={`rounded-lg border p-3 ${r.color}`}>
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" />
                  {r.role}
                </div>
                <p className="text-xs mt-1 opacity-90">{r.blurb}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by page, route or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
            {!isSuperAdmin && (
              <Badge variant="outline" className="ml-auto gap-1">
                <Lock className="h-3 w-3" /> Read-only (Super Admin required to edit)
              </Badge>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[200px]">Page</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="text-center w-[110px]">
                    <div className="flex items-center justify-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-purple-600" /> Super Admin
                    </div>
                  </TableHead>
                  <TableHead className="text-center w-[100px]">
                    <div className="flex items-center justify-center gap-1">
                      <Shield className="h-3.5 w-3.5 text-blue-600" /> Admin
                    </div>
                  </TableHead>
                  <TableHead className="text-center w-[110px]">
                    <div className="flex items-center justify-center gap-1">
                      <Briefcase className="h-3.5 w-3.5 text-emerald-600" /> Sales Head
                    </div>
                  </TableHead>
                  <TableHead className="text-center w-[100px]">
                    <div className="flex items-center justify-center gap-1">
                      <UserIcon className="h-3.5 w-3.5" /> User
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((permission) => (
                  <TableRow key={permission.id}>
                    <TableCell className="font-medium">
                      <div>
                        <div className="text-sm">{permission.page_name}</div>
                        {permission.description && (
                          <div className="text-xs text-muted-foreground">{permission.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {permission.route}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" /> Always
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={permission.admin_access}
                        onCheckedChange={(value) => handleToggle(permission.id, 'admin_access', value)}
                        disabled={!isSuperAdmin || updating === `${permission.id}-admin_access`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={permission.sales_head_access}
                        onCheckedChange={(value) => handleToggle(permission.id, 'sales_head_access', value)}
                        disabled={!isSuperAdmin || updating === `${permission.id}-sales_head_access`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={permission.user_access}
                        onCheckedChange={(value) => handleToggle(permission.id, 'user_access', value)}
                        disabled={!isSuperAdmin || updating === `${permission.id}-user_access`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No pages match your search
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PageAccessSettings;
