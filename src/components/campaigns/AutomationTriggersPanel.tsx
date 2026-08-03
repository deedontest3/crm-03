import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useCanManageCampaign } from "@/hooks/useCanManageCampaign";

interface Props {
  campaignId: string;
  isReadOnly?: boolean;
}

const TRIGGER_EVENTS = [
  { value: "account_status_changed", label: "Account status changed" },
  { value: "deal_stage_changed", label: "Deal stage changed" },
  { value: "contact_created", label: "Contact created" },
] as const;

export function AutomationTriggersPanel({ campaignId, isReadOnly: isReadOnlyProp }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [event, setEvent] = useState<string>("account_status_changed");
  const [toValue, setToValue] = useState("");
  const { canManage } = useCanManageCampaign(campaignId);
  // Non-managers see the triggers read-only (server also enforces this on the
  // process-automation-triggers path).
  const isReadOnly = isReadOnlyProp || !canManage;

  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ["campaign-automation-triggers", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_automation_triggers")
        .select("id, name, trigger_event, condition, is_enabled, enrolled_count, last_run_at, created_at")
        .eq("target_campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const condition: Record<string, string> = {};
      if (toValue.trim()) condition.to = toValue.trim();
      const { error } = await supabase.from("campaign_automation_triggers").insert({
        name: name.trim(),
        trigger_event: event,
        condition,
        target_campaign_id: campaignId,
        is_enabled: true,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-automation-triggers", campaignId] });
      toast({ title: "Trigger created" });
      setOpen(false);
      setName("");
      setToValue("");
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("campaign_automation_triggers")
        .update({ is_enabled: enabled })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign-automation-triggers", campaignId] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaign_automation_triggers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-automation-triggers", campaignId] });
      toast({ title: "Trigger deleted" });
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Automation Triggers
        </CardTitle>
        {!isReadOnly && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-3 w-3 mr-1" /> Add Trigger
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Automation Trigger</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Auto-enroll qualified accounts" />
                </div>
                <div>
                  <Label>Event</Label>
                  <Select value={event} onValueChange={setEvent}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[100]">
                      {TRIGGER_EVENTS.map((e) => (
                        <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(event === "account_status_changed" || event === "deal_stage_changed") && (
                  <div>
                    <Label>Match "to" value (optional)</Label>
                    <Input value={toValue} onChange={(e) => setToValue(e.target.value)} placeholder="e.g. Qualified" />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
                  {createMut.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">Loading…</div>
        ) : triggers.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No automation triggers. Auto-enroll contacts when CRM events fire.
          </div>
        ) : (
          triggers.map((t: any) => {
            const cond = (t.condition || {}) as Record<string, string>;
            return (
              <div key={t.id} className="flex items-center justify-between border rounded-md p-3 gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{t.name}</span>
                    <Badge variant="outline" className="text-xs">{t.trigger_event}</Badge>
                    {cond.to && <Badge variant="secondary" className="text-xs">→ {cond.to}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Enrolled: {t.enrolled_count ?? 0}
                    {t.last_run_at && ` • Last ran ${formatDistanceToNow(new Date(t.last_run_at), { addSuffix: true })}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={t.is_enabled}
                    disabled={isReadOnly || toggleMut.isPending}
                    onCheckedChange={(v) => toggleMut.mutate({ id: t.id, enabled: v })}
                  />
                  {!isReadOnly && (
                    <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(t.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
