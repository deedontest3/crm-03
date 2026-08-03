import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";

interface Props {
  campaignId: string;
}

export function ApprovalsBanner({ campaignId }: Props) {
  const qc = useQueryClient();

  const { data: pending = [] } = useQuery({
    queryKey: ["campaign-approvals-pending", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_approvals")
        .select("id, recipient_count, threshold, reason, requested_at, requested_by")
        .eq("campaign_id", campaignId)
        .eq("status", "pending")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const { data: isAdmin } = useQuery({
    queryKey: ["is-admin-current"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
  });

  const requesterIds = pending.map((p: any) => p.requested_by).filter(Boolean);
  const { displayNames } = useUserDisplayNames(requesterIds);

  const decideMut = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("campaign_approvals")
        .update({
          status: approve ? "approved" : "rejected",
          approver_user_id: user.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["campaign-approvals-pending", campaignId] });
      toast({ title: vars.approve ? "Approved" : "Rejected" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (pending.length === 0) return null;

  return (
    <div className="space-y-2">
      {pending.map((p: any) => (
        <Alert key={p.id} className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900 dark:text-amber-200">
            Approval required: {p.recipient_count} recipients
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap text-amber-800 dark:text-amber-300">
            <span className="text-sm">
              Requested by {displayNames[p.requested_by] || "user"} • exceeds threshold of {p.threshold}
              {p.reason && ` — ${p.reason}`}
            </span>
            {isAdmin && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => decideMut.mutate({ id: p.id, approve: false })}
                  disabled={decideMut.isPending}
                >
                  <X className="h-3 w-3 mr-1" /> Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => decideMut.mutate({ id: p.id, approve: true })}
                  disabled={decideMut.isPending}
                >
                  <Check className="h-3 w-3 mr-1" /> Approve
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
