import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useCampaignDetail } from "@/hooks/useCampaigns";
import type { Campaign } from "@/hooks/useCampaigns";
import { Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface Props {
  campaign: Campaign;
  isCampaignEnded: boolean;
  daysRemaining: number | null;
  timingNotes?: string | null;
  onSaveTimingNotes?: (notes: string) => void;
}

export function CampaignMARTTiming({ campaign, isCampaignEnded, daysRemaining, timingNotes, onSaveTimingNotes }: Props) {
  const [notes, setNotes] = useState(timingNotes || "");

  // Progress bar color
  const getProgressColor = () => {
    if (isCampaignEnded) return "bg-destructive";
    if (daysRemaining !== null && daysRemaining <= 7) return "bg-yellow-500";
    return "bg-primary";
  };

  // Calculate progress percentage
  const getProgress = () => {
    if (!campaign.start_date || !campaign.end_date) return 0;
    const start = new Date(campaign.start_date + "T00:00:00").getTime();
    const end = new Date(campaign.end_date + "T00:00:00").getTime();
    const now = Date.now();
    if (now >= end) return 100;
    if (now <= start) return 0;
    return Math.round(((now - start) / (end - start)) * 100);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Campaign Timing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Campaign Start</p>
            <p className="text-lg font-medium">{campaign.start_date ? format(new Date(campaign.start_date + "T00:00:00"), "dd MMM yyyy") : "Not set"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Campaign End</p>
            <p className="text-lg font-medium">{campaign.end_date ? format(new Date(campaign.end_date + "T00:00:00"), "dd MMM yyyy") : "Not set"}</p>
          </div>
        </div>

        {/* Days remaining / ended */}
        {isCampaignEnded ? (
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Ended
            </Badge>
            {campaign.end_date && (
              <span className="text-sm text-muted-foreground">
                Ended {Math.abs(daysRemaining || 0)} days ago
              </span>
            )}
          </div>
        ) : daysRemaining !== null ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-base px-3 py-1">
              <Clock className="h-4 w-4 mr-1" /> {daysRemaining} days remaining
            </Badge>
          </div>
        ) : null}

        {/* Progress bar */}
        {campaign.start_date && campaign.end_date && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{getProgress()}%</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${getProgressColor()}`} style={{ width: `${getProgress()}%` }} />
            </div>
          </div>
        )}

        {/* Timing Note */}
        <div className="space-y-2">
          <Label className="text-sm">Timing Note</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Must complete outreach before Diwali..."
            rows={2}
            className="text-sm"
          />
          {onSaveTimingNotes && (
            <Button variant="outline" size="sm" onClick={() => onSaveTimingNotes(notes)}>
              Save Note
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
