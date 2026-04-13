import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { CampaignMARTMessage } from "./CampaignMARTMessage";
import { CampaignMARTAudience } from "./CampaignMARTAudience";
import { CampaignMARTRegion } from "./CampaignMARTRegion";
import { CampaignMARTTiming } from "./CampaignMARTTiming";
import type { Campaign } from "@/hooks/useCampaigns";

interface Props {
  campaignId: string;
  campaign: Campaign;
  isMARTComplete: { message: boolean; audience: boolean; region: boolean; timing: boolean };
  updateMartFlag: (flag: string, value: boolean) => Promise<void>;
  isCampaignEnded: boolean;
  daysRemaining: number | null;
  timingNotes?: string | null;
}

export function CampaignMARTStrategy({ campaignId, campaign, isMARTComplete, updateMartFlag, isCampaignEnded, daysRemaining, timingNotes }: Props) {
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    message: true, audience: false, region: false, timing: false,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleMarkDone = async (flag: string, label: string) => {
    await updateMartFlag(flag, true);
    toast.success(`${label} marked as done`);
  };

  const handleUnmark = async (flag: string, label: string) => {
    await updateMartFlag(flag, false);
    toast.info(`${label} unmarked`);
  };

  const handleSaveTimingNotes = async (notes: string) => {
    if (!campaignId) return;
    const { data: existing } = await supabase.from("campaign_mart").select("campaign_id").eq("campaign_id", campaignId).maybeSingle();
    if (existing) {
      await supabase.from("campaign_mart").update({ timing_notes: notes }).eq("campaign_id", campaignId);
    } else {
      await supabase.from("campaign_mart").insert({ campaign_id: campaignId, timing_notes: notes });
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-mart", campaignId] });
    toast.success("Timing note saved");
  };

  const sections = [
    { key: "message", label: "Message", flag: "message_done", done: isMARTComplete.message },
    { key: "audience", label: "Audience", flag: "audience_done", done: isMARTComplete.audience },
    { key: "region", label: "Region", flag: "region_done", done: isMARTComplete.region },
    { key: "timing", label: "Timing", flag: "timing_done", done: isMARTComplete.timing },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <Card key={section.key}>
          <Collapsible open={openSections[section.key]} onOpenChange={() => toggleSection(section.key)}>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-3 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {openSections[section.key] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {section.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                    <CardTitle className="text-base">{section.label}</CardTitle>
                    {section.done && <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">Done</Badge>}
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {section.done ? (
                      <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleUnmark(section.flag, section.label)}>Unmark</Button>
                    ) : (
                      <Button size="sm" className="text-xs" onClick={() => handleMarkDone(section.flag, section.label)}>Save & Mark Done</Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                {section.key === "message" && <CampaignMARTMessage campaignId={campaignId} />}
                {section.key === "audience" && <CampaignMARTAudience campaign={campaign} />}
                {section.key === "region" && <CampaignMARTRegion campaign={campaign} />}
                {section.key === "timing" && (
                  <CampaignMARTTiming
                    campaign={campaign}
                    isCampaignEnded={isCampaignEnded}
                    daysRemaining={daysRemaining}
                    timingNotes={timingNotes}
                    onSaveTimingNotes={handleSaveTimingNotes}
                  />
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}
    </div>
  );
}
