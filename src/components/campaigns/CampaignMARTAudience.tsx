import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useState, KeyboardEvent } from "react";
import { Users, X } from "lucide-react";

interface AudienceData {
  job_titles: string[];
  departments: string[];
  seniorities: string[];
  industries: string[];
  company_sizes: string[];
}

const DEPARTMENTS = ["Sales", "Marketing", "Operations", "Engineering", "Finance", "HR", "Other"];
const SENIORITIES = ["C-Suite", "VP", "Director", "Manager", "Team Lead", "Individual Contributor"];
const COMPANY_SIZES = ["1–10", "11–50", "51–200", "201–1000", "1000+"];

function parseAudience(raw: string | null): AudienceData {
  const empty: AudienceData = { job_titles: [], departments: [], seniorities: [], industries: [], company_sizes: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    // New format
    if (parsed.job_titles) return { ...empty, ...parsed };
    // Legacy array format
    if (Array.isArray(parsed)) {
      const first = parsed[0] || {};
      return {
        job_titles: first.job_title ? [first.job_title] : [],
        departments: first.department ? [first.department] : [],
        seniorities: first.seniority ? [first.seniority] : [],
        industries: first.industry ? [first.industry] : [],
        company_sizes: first.company_size ? [first.company_size] : [],
      };
    }
  } catch {}
  return empty;
}

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (tags: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) onChange([...tags, input.trim()]);
      setInput("");
    }
  };
  const removeTag = (tag: string) => onChange(tags.filter(t => t !== tag));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {tags.map(tag => (
          <Badge key={tag} variant="secondary" className="flex items-center gap-1 text-xs">
            {tag}
            <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={placeholder} className="h-8 text-sm" />
    </div>
  );
}

function MultiCheckbox({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (selected: string[]) => void }) {
  const toggle = (opt: string) => onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map(opt => (
        <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
          <Checkbox checked={selected.includes(opt)} onCheckedChange={() => toggle(opt)} />
          {opt}
        </label>
      ))}
    </div>
  );
}

interface Props {
  campaign: Campaign;
}

export function CampaignMARTAudience({ campaign }: Props) {
  const { updateCampaign } = useCampaigns();
  const [data, setData] = useState<AudienceData>(() => parseAudience(campaign.target_audience));
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    updateCampaign.mutate(
      { id: campaign.id, target_audience: JSON.stringify(data) },
      { onSettled: () => setSaving(false) }
    );
  };

  const hasContent = data.job_titles.length > 0 || data.departments.length > 0 || data.seniorities.length > 0 || data.industries.length > 0 || data.company_sizes.length > 0;

  // Auto-generated summary
  const summaryParts: string[] = [];
  if (data.seniorities.length) summaryParts.push(data.seniorities.join(", "));
  if (data.industries.length) summaryParts.push(`in ${data.industries.join(", ")}`);
  if (data.company_sizes.length) summaryParts.push(`companies with ${data.company_sizes.join(" or ")} employees`);
  const summary = summaryParts.length > 0 ? `Targeting ${summaryParts.join(" ")}` : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Audience Targeting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-sm">Job Titles <span className="text-xs text-muted-foreground">(type and press Enter)</span></Label>
          <TagInput tags={data.job_titles} onChange={tags => setData({ ...data, job_titles: tags })} placeholder="e.g. CEO, VP of Sales..." />
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Departments</Label>
          <MultiCheckbox options={DEPARTMENTS} selected={data.departments} onChange={deps => setData({ ...data, departments: deps })} />
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Seniority</Label>
          <MultiCheckbox options={SENIORITIES} selected={data.seniorities} onChange={sens => setData({ ...data, seniorities: sens })} />
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Industries <span className="text-xs text-muted-foreground">(type and press Enter)</span></Label>
          <TagInput tags={data.industries} onChange={tags => setData({ ...data, industries: tags })} placeholder="e.g. SaaS, FinTech..." />
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Company Sizes</Label>
          <MultiCheckbox options={COMPANY_SIZES} selected={data.company_sizes} onChange={sizes => setData({ ...data, company_sizes: sizes })} />
        </div>

        {summary && (
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground italic">{summary}</p>
          </div>
        )}

        <Button onClick={handleSave} disabled={saving || !hasContent}>
          {saving ? "Saving..." : "Save Audience"}
        </Button>
      </CardContent>
    </Card>
  );
}
