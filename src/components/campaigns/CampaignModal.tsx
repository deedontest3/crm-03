import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns, type CampaignFormData, type Campaign } from "@/hooks/useCampaigns";
import { useAllUsers } from "@/hooks/useUserDisplayNames";

const CAMPAIGN_TYPES = ["Cold Outreach", "Nurture", "Re-engagement", "Event", "Product Launch"];

interface CampaignModalProps {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
  isMARTComplete?: boolean;
  onCreated?: (id: string) => void;
}

export function CampaignModal({ open, onClose, campaign, isMARTComplete = false, onCreated }: CampaignModalProps) {
  const { user } = useAuth();
  const { createCampaign, updateCampaign } = useCampaigns();
  const { users: allUsers } = useAllUsers();
  const isEditing = !!campaign;

  const [formData, setFormData] = useState<CampaignFormData>({
    campaign_name: "",
    campaign_type: "Cold Outreach",
    goal: "",
    owner: user?.id || "",
    start_date: "",
    end_date: "",
    status: "Draft",
    notes: "",
    description: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (campaign) {
      setFormData({
        campaign_name: campaign.campaign_name,
        campaign_type: campaign.campaign_type || "Cold Outreach",
        goal: campaign.goal || "",
        owner: campaign.owner || user?.id || "",
        start_date: campaign.start_date || "",
        end_date: campaign.end_date || "",
        status: campaign.status || "Draft",
        notes: campaign.notes || "",
        description: campaign.description || "",
      });
    } else {
      setFormData({
        campaign_name: "",
        campaign_type: "Cold Outreach",
        goal: "",
        owner: user?.id || "",
        start_date: "",
        end_date: "",
        status: "Draft",
        notes: "",
        description: "",
      });
    }
    setErrors({});
  }, [campaign, open, user?.id]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.campaign_name.trim() || formData.campaign_name.trim().length < 2) newErrors.campaign_name = "Campaign name is required (min 2 chars)";
    if (!formData.campaign_type) newErrors.campaign_type = "Type is required";
    if (!formData.goal.trim()) newErrors.goal = "Goal is required";
    if (!formData.owner) newErrors.owner = "Owner is required";
    if (!formData.start_date) newErrors.start_date = "Start date is required";
    if (!formData.end_date) newErrors.end_date = "End date is required";
    if (formData.start_date && formData.end_date && formData.start_date >= formData.end_date) {
      newErrors.end_date = "End date must be after start date";
    }
    if (isEditing && formData.status === "Active" && !isMARTComplete) {
      newErrors.status = "Complete all MART sections before setting Active";
    }
    // Block Completed campaigns from changing status
    if (isEditing && campaign?.status === "Completed" && formData.status !== "Completed") {
      newErrors.status = "Completed campaigns cannot be reactivated";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;

    if (isEditing && campaign) {
      updateCampaign.mutate({ id: campaign.id, ...formData }, { onSuccess: onClose });
    } else {
      createCampaign.mutate(formData, {
        onSuccess: (data) => {
          onClose();
          if (onCreated && data?.id) onCreated(data.id);
        },
      });
    }
  };

  // Statuses available based on MART completion and current status
  const getAvailableStatuses = () => {
    if (isEditing && campaign?.status === "Completed") return ["Completed"];
    const statuses = ["Draft", "Paused", "Completed"];
    if (isMARTComplete) statuses.splice(1, 0, "Active");
    return statuses;
  };

  const ownerOptions = allUsers.map((u) => ({ id: u.id, name: u.display_name }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="campaign_name">Campaign Name *</Label>
            <Input id="campaign_name" value={formData.campaign_name} onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })} placeholder="Enter campaign name" />
            {errors.campaign_name && <p className="text-sm text-destructive">{errors.campaign_name}</p>}
          </div>

          <div className="space-y-2">
            <Label>Campaign Type *</Label>
            <Select value={formData.campaign_type} onValueChange={(v) => setFormData({ ...formData, campaign_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAMPAIGN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.campaign_type && <p className="text-sm text-destructive">{errors.campaign_type}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal">Campaign Goal *</Label>
            <Textarea id="goal" value={formData.goal} onChange={(e) => setFormData({ ...formData, goal: e.target.value })} placeholder="Describe the campaign goal" rows={3} />
            {errors.goal && <p className="text-sm text-destructive">{errors.goal}</p>}
          </div>

          <div className="space-y-2">
            <Label>Owner *</Label>
            <Select value={formData.owner} onValueChange={(v) => setFormData({ ...formData, owner: v })}>
              <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
              <SelectContent>
                {ownerOptions.length > 0 ? (
                  ownerOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)
                ) : (
                  <SelectItem value={user?.id || ""}>{user?.user_metadata?.full_name || user?.email || "Me"}</SelectItem>
                )}
              </SelectContent>
            </Select>
            {errors.owner && <p className="text-sm text-destructive">{errors.owner}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date *</Label>
              <Input id="start_date" type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
              {errors.start_date && <p className="text-sm text-destructive">{errors.start_date}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date *</Label>
              <Input id="end_date" type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
              {errors.end_date && <p className="text-sm text-destructive">{errors.end_date}</p>}
            </div>
          </div>

          {isEditing && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getAvailableStatuses().map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.status && <p className="text-sm text-destructive">{errors.status}</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Campaign description..." rows={2} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional notes..." rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createCampaign.isPending || updateCampaign.isPending}>
            {createCampaign.isPending || updateCampaign.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
