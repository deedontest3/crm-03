import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Mail, Phone, MessageSquare, Upload, FileText, Pencil, Download, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Props {
  campaignId: string;
}

const SEGMENTS = ["C-Suite", "VP", "Director", "Manager", "Team Lead", "Individual Contributor"];

function DynamicList({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const addItem = () => onChange([...items, ""]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, val: string) => onChange(items.map((item, idx) => idx === i ? val : item));

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={item} onChange={(e) => updateItem(i, e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeItem(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
    </div>
  );
}

function ObjectionList({ items, onChange }: { items: { objection: string; response: string }[]; onChange: (items: { objection: string; response: string }[]) => void }) {
  const addItem = () => onChange([...items, { objection: "", response: "" }]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: "objection" | "response", val: string) =>
    onChange(items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Objection {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(i)}><X className="h-3 w-3" /></Button>
          </div>
          <Input value={item.objection} onChange={(e) => updateItem(i, "objection", e.target.value)} placeholder="Objection..." className="h-8 text-sm" />
          <Input value={item.response} onChange={(e) => updateItem(i, "response", e.target.value)} placeholder="Response..." className="h-8 text-sm" />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" /> Add Objection</Button>
    </div>
  );
}

function parseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try { const arr = JSON.parse(text); return Array.isArray(arr) ? arr : [text]; } catch { return text ? text.split("\n").filter(Boolean) : []; }
}

function parseObjectionArray(text: string | null): { objection: string; response: string }[] {
  if (!text) return [];
  try { const arr = JSON.parse(text); return Array.isArray(arr) ? arr : []; } catch { return text ? [{ objection: text, response: "" }] : []; }
}

export function CampaignMARTMessage({ campaignId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [editEmailId, setEditEmailId] = useState<string | null>(null);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [editScriptId, setEditScriptId] = useState<string | null>(null);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [editLinkedinId, setEditLinkedinId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_email_templates").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: phoneScripts = [] } = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_phone_scripts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["campaign-materials", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_materials").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const linkedinTemplates = emailTemplates.filter((t) => t.email_type === "LinkedIn-Connection" || t.email_type === "LinkedIn-Followup");
  const regularEmailTemplates = emailTemplates.filter((t) => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup");

  // Email template form — signature stored in body after separator, segments as comma-separated audience_segment
  const [emailForm, setEmailForm] = useState({ template_name: "", subject: "", body: "", email_type: "Initial", audience_segment: [] as string[], signature: "" });

  const openEmailEdit = (t: any) => {
    // Parse segments from comma-separated
    const segs = t.audience_segment ? t.audience_segment.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    // Parse signature — stored as last line after "---SIGNATURE---"
    let body = t.body || "";
    let sig = "";
    const sigIdx = body.indexOf("---SIGNATURE---");
    if (sigIdx !== -1) { sig = body.substring(sigIdx + 15).trim(); body = body.substring(0, sigIdx).trim(); }
    setEmailForm({ template_name: t.template_name, subject: t.subject || "", body, email_type: t.email_type || "Initial", audience_segment: segs, signature: sig });
    setEditEmailId(t.id);
    setEmailModalOpen(true);
  };

  const openEmailCreate = () => {
    setEmailForm({ template_name: "", subject: "", body: "", email_type: "Initial", audience_segment: [], signature: "" });
    setEditEmailId(null);
    setEmailModalOpen(true);
  };

  const saveEmailTemplate = async () => {
    const bodyWithSig = emailForm.signature ? `${emailForm.body}\n---SIGNATURE---${emailForm.signature}` : emailForm.body;
    const segStr = emailForm.audience_segment.join(", ");
    const payload = { template_name: emailForm.template_name, subject: emailForm.subject, body: bodyWithSig, email_type: emailForm.email_type, audience_segment: segStr || null, campaign_id: campaignId, created_by: user!.id };

    if (editEmailId) {
      const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editEmailId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    setEmailModalOpen(false);
    toast({ title: editEmailId ? "Template updated" : "Template saved" });
  };

  const deleteEmailTemplate = async (id: string) => {
    await supabase.from("campaign_email_templates").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
  };

  const toggleSegment = (seg: string) => {
    setEmailForm(prev => ({
      ...prev,
      audience_segment: prev.audience_segment.includes(seg) ? prev.audience_segment.filter(s => s !== seg) : [...prev.audience_segment, seg]
    }));
  };

  // Phone script form — dynamic lists stored as JSON
  const [scriptForm, setScriptForm] = useState({
    script_name: "", opening_script: "", talking_points: [] as string[],
    questions: [] as string[], objections: [] as { objection: string; response: string }[], audience_segment: "",
  });

  const openScriptEdit = (s: any) => {
    setScriptForm({
      script_name: s.script_name || "", opening_script: s.opening_script || "",
      talking_points: parseJsonArray(s.key_talking_points),
      questions: parseJsonArray(s.discovery_questions),
      objections: parseObjectionArray(s.objection_handling),
      audience_segment: s.audience_segment || "",
    });
    setEditScriptId(s.id);
    setScriptModalOpen(true);
  };

  const openScriptCreate = () => {
    setScriptForm({ script_name: "", opening_script: "", talking_points: [""], questions: [""], objections: [{ objection: "", response: "" }], audience_segment: "" });
    setEditScriptId(null);
    setScriptModalOpen(true);
  };

  const savePhoneScript = async () => {
    const payload = {
      script_name: scriptForm.script_name, opening_script: scriptForm.opening_script,
      key_talking_points: JSON.stringify(scriptForm.talking_points.filter(Boolean)),
      discovery_questions: JSON.stringify(scriptForm.questions.filter(Boolean)),
      objection_handling: JSON.stringify(scriptForm.objections.filter(o => o.objection || o.response)),
      audience_segment: scriptForm.audience_segment || null,
      campaign_id: campaignId, created_by: user!.id,
    };
    if (editScriptId) {
      const { error } = await supabase.from("campaign_phone_scripts").update(payload).eq("id", editScriptId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_phone_scripts").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
    setScriptModalOpen(false);
    toast({ title: editScriptId ? "Script updated" : "Script saved" });
  };

  const deletePhoneScript = async (id: string) => {
    await supabase.from("campaign_phone_scripts").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
  };

  // LinkedIn template form with char counter
  const [linkedinForm, setLinkedinForm] = useState({ template_name: "", body: "", email_type: "LinkedIn-Connection" as string });
  const linkedinMaxChars = linkedinForm.email_type === "LinkedIn-Connection" ? 300 : 1000;
  const linkedinCharCount = linkedinForm.body.length;
  const linkedinOverLimit = linkedinCharCount > linkedinMaxChars;

  const openLinkedinEdit = (t: any) => {
    setLinkedinForm({ template_name: t.template_name, body: t.body || "", email_type: t.email_type || "LinkedIn-Connection" });
    setEditLinkedinId(t.id);
    setLinkedinModalOpen(true);
  };

  const openLinkedinCreate = () => {
    setLinkedinForm({ template_name: "", body: "", email_type: "LinkedIn-Connection" });
    setEditLinkedinId(null);
    setLinkedinModalOpen(true);
  };

  const saveLinkedinTemplate = async () => {
    if (linkedinOverLimit) { toast({ title: "Message too long", description: `Max ${linkedinMaxChars} characters.`, variant: "destructive" }); return; }
    const payload = { template_name: linkedinForm.template_name, body: linkedinForm.body, email_type: linkedinForm.email_type, campaign_id: campaignId, created_by: user!.id };
    if (editLinkedinId) {
      const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editLinkedinId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    setLinkedinModalOpen(false);
    toast({ title: editLinkedinId ? "Template updated" : "Template saved" });
  };

  // Materials
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const filePath = `${campaignId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("campaign-materials").upload(filePath, file);
      if (uploadError) { toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" }); continue; }
      const { error: dbError } = await supabase.from("campaign_materials").insert({
        campaign_id: campaignId, file_name: file.name, file_path: filePath,
        file_type: "Other", created_by: user!.id,
      });
      if (dbError) toast({ title: "Error saving material", description: dbError.message, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
    setUploading(false);
    toast({ title: "Materials uploaded" });
    e.target.value = "";
  };

  const deleteMaterial = async (id: string, filePath: string) => {
    await supabase.storage.from("campaign-materials").remove([filePath]);
    await supabase.from("campaign_materials").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
  };

  const downloadMaterial = async (filePath: string, fileName: string) => {
    const { data } = await supabase.storage.from("campaign-materials").createSignedUrl(filePath, 300);
    if (data?.signedUrl) { window.open(data.signedUrl, "_blank"); }
  };

  const updateMaterialType = async (id: string, type: string) => {
    await supabase.from("campaign_materials").update({ file_type: type }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
  };

  const MATERIAL_TYPES = ["One Pager", "Presentation", "Case Study", "Brochure", "Other"];

  return (
    <div className="space-y-6">
      {/* Email Templates */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" /> Email Templates</CardTitle>
          <Button size="sm" onClick={openEmailCreate}><Plus className="h-4 w-4 mr-1" /> Add Template</Button>
        </CardHeader>
        <CardContent>
          {regularEmailTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No email templates yet. Add one to complete the Message component.</p>
          ) : (
            <div className="space-y-3">
              {regularEmailTemplates.map((t) => {
                let displayBody = t.body || "";
                const sigIdx = displayBody.indexOf("---SIGNATURE---");
                if (sigIdx !== -1) displayBody = displayBody.substring(0, sigIdx).trim();
                const segs = t.audience_segment ? t.audience_segment.split(",").map((s: string) => s.trim()) : [];
                return (
                  <div key={t.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{t.email_type || "Initial"}</Badge>
                        <span className="font-medium text-sm">{t.subject}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEmailEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteEmailTemplate(t.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{displayBody}</p>
                    {segs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {segs.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Call Scripts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Phone className="h-4 w-4" /> Call Scripts</CardTitle>
          <Button size="sm" onClick={openScriptCreate}><Plus className="h-4 w-4 mr-1" /> Add Script</Button>
        </CardHeader>
        <CardContent>
          {phoneScripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No call scripts yet.</p>
          ) : (
            <div className="space-y-3">
              {phoneScripts.map((s) => {
                const points = parseJsonArray(s.key_talking_points);
                const qs = parseJsonArray(s.discovery_questions);
                const objs = parseObjectionArray(s.objection_handling);
                return (
                  <div key={s.id} className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{s.script_name || "Script"}</span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openScriptEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePhoneScript(s.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      </div>
                    </div>
                    {s.opening_script && <p className="text-sm text-muted-foreground mb-1">Opening: {s.opening_script}</p>}
                    {points.length > 0 && <p className="text-xs text-muted-foreground">{points.length} talking point(s)</p>}
                    {qs.length > 0 && <p className="text-xs text-muted-foreground">{qs.length} question(s)</p>}
                    {objs.length > 0 && <p className="text-xs text-muted-foreground">{objs.length} objection(s)</p>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LinkedIn Messages */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" /> LinkedIn Messages</CardTitle>
          <Button size="sm" onClick={openLinkedinCreate}><Plus className="h-4 w-4 mr-1" /> Add Template</Button>
        </CardHeader>
        <CardContent>
          {linkedinTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No LinkedIn message templates yet.</p>
          ) : (
            <div className="space-y-3">
              {linkedinTemplates.map((t) => (
                <div key={t.id} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{t.email_type === "LinkedIn-Connection" ? "Connection Request" : "Follow-up"}</Badge>
                      <span className="font-medium text-sm">{t.template_name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLinkedinEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteEmailTemplate(t.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{t.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(t.body || "").length} / {t.email_type === "LinkedIn-Connection" ? 300 : 1000} chars</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Marketing Materials */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Marketing Materials</CardTitle>
          <div>
            <input type="file" id="material-upload" className="hidden" multiple onChange={handleFileUpload} accept=".pdf,.pptx,.ppt,.doc,.docx,.png,.jpg,.jpeg" />
            <Button size="sm" onClick={() => document.getElementById("material-upload")?.click()} disabled={uploading}>
              <Upload className="h-4 w-4 mr-1" /> {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No marketing materials uploaded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materials.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.file_name}</TableCell>
                    <TableCell>
                      <Select value={m.file_type || "Other"} onValueChange={(v) => updateMaterialType(m.id, v)}>
                        <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MATERIAL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadMaterial(m.file_path, m.file_name)}><Download className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMaterial(m.id, m.file_path)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email Template Modal */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editEmailId ? "Edit" : "Add"} Email Template</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input value={emailForm.template_name} onChange={(e) => setEmailForm({ ...emailForm, template_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Body *</Label>
              <Textarea value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} rows={5} />
            </div>
            <div className="space-y-2">
              <Label>Signature</Label>
              <Input value={emailForm.signature} onChange={(e) => setEmailForm({ ...emailForm, signature: e.target.value })} placeholder="e.g. Regards, Your Name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={emailForm.email_type} onValueChange={(v) => setEmailForm({ ...emailForm, email_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Initial">Initial</SelectItem>
                    <SelectItem value="Follow-up">Follow-up</SelectItem>
                    <SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assign to Segments</Label>
              <div className="flex flex-wrap gap-2">
                {SEGMENTS.map(seg => (
                  <label key={seg} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={emailForm.audience_segment.includes(seg)} onCheckedChange={() => toggleSegment(seg)} />
                    {seg}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailModalOpen(false)}>Cancel</Button>
            <Button onClick={saveEmailTemplate} disabled={!emailForm.template_name || !emailForm.subject || !emailForm.body}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phone Script Modal */}
      <Dialog open={scriptModalOpen} onOpenChange={setScriptModalOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editScriptId ? "Edit" : "Add"} Call Script</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Script Name *</Label>
              <Input value={scriptForm.script_name} onChange={(e) => setScriptForm({ ...scriptForm, script_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Opening Script</Label>
              <Textarea value={scriptForm.opening_script} onChange={(e) => setScriptForm({ ...scriptForm, opening_script: e.target.value })} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Talking Points</Label>
              <DynamicList items={scriptForm.talking_points} onChange={(items) => setScriptForm({ ...scriptForm, talking_points: items })} placeholder="Talking point..." />
            </div>
            <div className="space-y-2">
              <Label>Discovery Questions</Label>
              <DynamicList items={scriptForm.questions} onChange={(items) => setScriptForm({ ...scriptForm, questions: items })} placeholder="Question..." />
            </div>
            <div className="space-y-2">
              <Label>Objection Handling</Label>
              <ObjectionList items={scriptForm.objections} onChange={(items) => setScriptForm({ ...scriptForm, objections: items })} />
            </div>
            <div className="space-y-2">
              <Label>Audience Segment</Label>
              <Input value={scriptForm.audience_segment} onChange={(e) => setScriptForm({ ...scriptForm, audience_segment: e.target.value })} placeholder="e.g. Manager" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScriptModalOpen(false)}>Cancel</Button>
            <Button onClick={savePhoneScript} disabled={!scriptForm.script_name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LinkedIn Template Modal */}
      <Dialog open={linkedinModalOpen} onOpenChange={setLinkedinModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editLinkedinId ? "Edit" : "Add"} LinkedIn Message</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input value={linkedinForm.template_name} onChange={(e) => setLinkedinForm({ ...linkedinForm, template_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={linkedinForm.email_type} onValueChange={(v) => setLinkedinForm({ ...linkedinForm, email_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LinkedIn-Connection">Connection Request (max 300 chars)</SelectItem>
                  <SelectItem value="LinkedIn-Followup">Follow-up Message (max 1000 chars)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea value={linkedinForm.body} onChange={(e) => setLinkedinForm({ ...linkedinForm, body: e.target.value })} rows={5} placeholder="Write your LinkedIn message..." />
              <div className={`text-xs text-right ${linkedinOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                {linkedinCharCount} / {linkedinMaxChars} characters
                {linkedinOverLimit && " — Too long!"}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkedinModalOpen(false)}>Cancel</Button>
            <Button onClick={saveLinkedinTemplate} disabled={!linkedinForm.template_name || !linkedinForm.body || linkedinOverLimit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
