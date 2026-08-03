import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PauseCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCanManageCampaign } from "@/hooks/useCanManageCampaign";

interface Props {
  campaignId: string;
  size?: "sm" | "default";
  variant?: "outline" | "destructive" | "ghost";
}

export function PauseAllSendsButton({ campaignId, size = "sm", variant = "outline" }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { canManage } = useCanManageCampaign(campaignId);

  // Hide the control entirely for users who don't manage this campaign; the
  // pause_all_campaign_jobs RPC is also enforced server-side.
  if (!canManage) return null;

  const pauseMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pause_all_campaign_jobs", {
        _campaign_id: campaignId,
        _reason: "Operator clicked Pause All",
      });
      if (error) throw error;
      return data as { items_paused: number; jobs_paused: number };
    },
    onSuccess: (res) => {
      toast({
        title: "All sends paused",
        description: `${res?.items_paused ?? 0} items, ${res?.jobs_paused ?? 0} jobs paused.`,
      });
      qc.invalidateQueries({ queryKey: ["campaign-send-jobs", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign-events", campaignId] });
      setOpen(false);
    },
    onError: (e: any) =>
      toast({ title: "Failed to pause", description: e.message, variant: "destructive" }),
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size={size} variant={variant}>
          <PauseCircle className="h-4 w-4 mr-1.5" /> Pause All Sends
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause all sends for this campaign?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops all queued and in-flight send jobs immediately. Sends already
            handed to the email provider cannot be recalled. You can resume jobs individually later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              pauseMut.mutate();
            }}
            disabled={pauseMut.isPending}
          >
            {pauseMut.isPending ? "Pausing…" : "Pause all"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
