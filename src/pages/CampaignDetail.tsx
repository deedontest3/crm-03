import { useParams, useNavigate } from "react-router-dom";
import { useCampaignDetail, useCampaigns } from "@/hooks/useCampaigns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Clock, AlertTriangle, CheckCircle2, Circle, Target, FileText, Users, Building2, MessageSquare, BarChart3, ChevronDown, ListTodo, Megaphone } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CampaignModal } from "@/components/campaigns/CampaignModal";
import { CampaignMARTStrategy } from "@/components/campaigns/CampaignMARTStrategy";
import { CampaignAccounts } from "@/components/campaigns/CampaignAccounts";
import { CampaignContacts } from "@/components/campaigns/CampaignContacts";
import { CampaignCommunications } from "@/components/campaigns/CampaignCommunications";
import { CampaignAnalytics } from "@/components/campaigns/CampaignAnalytics";
import { CampaignActionItems } from "@/components/campaigns/CampaignActionItems";

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useCampaignDetail(id);
  const { updateCampaign } = useCampaigns();
  const ownerIds = useMemo(() => [detail.campaign?.owner].filter(Boolean) as string[], [detail.campaign?.owner]);
  const { displayNames } = useUserDisplayNames(ownerIds);
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const autoCompleteRef = useRef(false);

  // Auto-complete campaign when end date is reached (only if Active)
  useEffect(() => {
    if (
      detail.campaign &&
      detail.isCampaignEnded &&
      detail.campaign.status === "Active" &&
      !autoCompleteRef.current
    ) {
      autoCompleteRef.current = true;
      updateCampaign.mutate({ id: detail.campaign.id, status: "Completed" });
      toast.info(`This campaign ended on ${detail.campaign.end_date} and has been marked Completed.`);
    }
  }, [detail.campaign, detail.isCampaignEnded]);

  if (detail.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-muted animate-pulse" />
          <div className="h-6 w-64 rounded bg-muted animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!detail.campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Campaign not found</p>
        <Button variant="outline" onClick={() => navigate("/campaigns")}>Back to Campaigns</Button>
      </div>
    );
  }

  const { campaign, isMARTComplete, martProgress, isFullyMARTComplete, isCampaignEnded, daysRemaining } = detail;

  // Status transition rules
  const handleStatusChange = (newStatus: string) => {
    const current = campaign.status || "Draft";

    // Completed lock
    if (current === "Completed") {
      toast.error("Completed campaigns cannot be reactivated.");
      return;
    }

    // MART gate for Active
    if (newStatus === "Active" && !isFullyMARTComplete) {
      toast.error("Complete all 4 MART sections before activating this campaign.");
      return;
    }

    updateCampaign.mutate({ id: campaign.id, status: newStatus });
  };

  const getAvailableStatuses = () => {
    const current = campaign.status || "Draft";
    if (current === "Completed") return [];
    const statuses = ["Draft", "Paused", "Completed"];
    if (isFullyMARTComplete) statuses.splice(1, 0, "Active");
    return statuses.filter((s) => s !== current);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/campaigns")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">{campaign.campaign_name}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {campaign.campaign_type} · Owner: {campaign.owner ? displayNames[campaign.owner] || "—" : "—"}
              {campaign.start_date && campaign.end_date && (
                <> · {format(new Date(campaign.start_date + "T00:00:00"), "dd MMM yyyy")} → {format(new Date(campaign.end_date + "T00:00:00"), "dd MMM yyyy")}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Badge className={statusColors[campaign.status || "Draft"]} variant="secondary">
                  {campaign.status || "Draft"}
                </Badge>
                {campaign.status !== "Completed" && <ChevronDown className="h-3 w-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {getAvailableStatuses().map((s) => (
                <DropdownMenuItem key={s} onClick={() => handleStatusChange(s)}>
                  <Badge className={`${statusColors[s]} mr-2`} variant="secondary">{s}</Badge>
                  Set to {s}
                </DropdownMenuItem>
              ))}
              {getAvailableStatuses().length === 0 && (
                <DropdownMenuItem disabled>No status changes available</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {isCampaignEnded && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Ended
            </Badge>
          )}
          {daysRemaining !== null && daysRemaining > 0 && !isCampaignEnded && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {daysRemaining}d left
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>Edit</Button>
        </div>
      </div>

      {/* Campaign ended warning */}
      {isCampaignEnded && (
        <div className="mx-6 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
          <AlertTriangle className="h-4 w-4" />
          This campaign ended on {campaign.end_date}. Outreach is closed.
        </div>
      )}

      {/* MART Progress — clickable pills */}
      <div className="px-6 pt-4">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">MART Strategy</span>
              <span className="text-sm text-muted-foreground">{martProgress}/4 Complete</span>
            </div>
            <Progress value={martProgress * 25} className="h-2 mb-3" />
            <div className="flex gap-2">
              {[
                { key: "M", label: "Message", done: isMARTComplete.message },
                { key: "A", label: "Audience", done: isMARTComplete.audience },
                { key: "R", label: "Region", done: isMARTComplete.region },
                { key: "T", label: "Timing", done: isMARTComplete.timing },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setActiveTab("mart")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    item.done
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-muted text-muted-foreground border border-border"
                  }`}
                >
                  {item.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-3.5 w-3.5" />
                  )}
                  {item.key}
                  <span className="hidden sm:inline">— {item.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7 Tabs per spec */}
      <div className="flex-1 overflow-hidden px-6 pt-4 pb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="overflow-x-auto">
            <TabsList className="w-fit">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="mart">MART Strategy</TabsTrigger>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="outreach">Outreach</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-auto mt-4">
            {/* Overview */}
            <TabsContent value="overview" className="mt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                {[
                  { label: "Accounts targeted", value: detail.accounts.length, icon: Building2 },
                  { label: "Contacts targeted", value: detail.contacts.length, icon: Users },
                  { label: "Emails sent", value: detail.communications.filter((c: any) => c.communication_type === "Email").length, icon: MessageSquare },
                  { label: "Calls made", value: detail.communications.filter((c: any) => c.communication_type === "Call").length, icon: MessageSquare },
                ].map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                      <p className="text-2xl font-semibold mt-1">{stat.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Details */}
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Details</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{campaign.campaign_type}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge className={statusColors[campaign.status || "Draft"]} variant="secondary">{campaign.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Owner</span><span>{campaign.owner ? displayNames[campaign.owner] || "—" : "—"}</span></div>
                  </CardContent>
                </Card>

                {/* MART Quick Status */}
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> MART Status</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {[
                      { label: "Message", done: isMARTComplete.message },
                      { label: "Audience", done: isMARTComplete.audience },
                      { label: "Region", done: isMARTComplete.region },
                      { label: "Timing", done: isMARTComplete.timing },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2 text-sm">
                        {item.done ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Recent Activity */}
                <Card>
                  <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Recent Activity</CardTitle></CardHeader>
                  <CardContent>
                    {detail.communications.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No activity yet</p>
                    ) : (
                      <div className="space-y-2">
                        {detail.communications.slice(0, 5).map((c: any) => (
                          <div key={c.id} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-xs shrink-0">{c.communication_type}</Badge>
                            <span className="truncate">{c.contacts?.contact_name || "Unknown"}</span>
                            <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                              {c.communication_date ? format(new Date(c.communication_date), "dd MMM") : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Goal & Notes */}
              {campaign.goal && (
                <Card className="mt-4">
                  <CardHeader className="py-3"><CardTitle className="text-sm">Goal</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground">{campaign.goal}</p></CardContent>
                </Card>
              )}
              {campaign.notes && (
                <Card className="mt-4">
                  <CardHeader className="py-3"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground whitespace-pre-wrap">{campaign.notes.replace(/\[timezone:.+?\]\s*/g, "").trim()}</p></CardContent>
                </Card>
              )}
            </TabsContent>

            {/* MART Strategy — unified tab */}
            <TabsContent value="mart" className="mt-0">
              <CampaignMARTStrategy
                campaignId={campaign.id}
                campaign={campaign}
                isMARTComplete={isMARTComplete}
                updateMartFlag={detail.updateMartFlag}
                isCampaignEnded={isCampaignEnded}
                daysRemaining={daysRemaining}
                timingNotes={detail.mart?.timing_notes}
              />
            </TabsContent>

            <TabsContent value="accounts" className="mt-0">
              <CampaignAccounts campaignId={campaign.id} isCampaignEnded={isCampaignEnded} />
            </TabsContent>
            <TabsContent value="contacts" className="mt-0">
              <CampaignContacts campaignId={campaign.id} isCampaignEnded={isCampaignEnded} campaignName={campaign.campaign_name} campaignOwner={campaign.owner} endDate={campaign.end_date} />
            </TabsContent>
            <TabsContent value="outreach" className="mt-0">
              <CampaignCommunications campaignId={campaign.id} isCampaignEnded={isCampaignEnded} />
            </TabsContent>
            <TabsContent value="tasks" className="mt-0">
              <CampaignActionItems campaignId={campaign.id} />
            </TabsContent>
            <TabsContent value="analytics" className="mt-0">
              <CampaignAnalytics campaignId={campaign.id} />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <CampaignModal open={editOpen} onClose={() => setEditOpen(false)} campaign={campaign} isMARTComplete={isFullyMARTComplete} />
    </div>
  );
}
