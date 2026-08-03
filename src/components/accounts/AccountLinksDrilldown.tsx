import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Users, Briefcase, Megaphone, ListTodo, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { LinkedAccountContact, LinkedDeal, LinkedCampaign, LinkedActionItem } from "@/lib/accountLinks";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountName: string;
  section?: "contacts" | "deals" | "campaigns" | "actions" | null;
  contacts: LinkedAccountContact[];
  deals: LinkedDeal[];
  campaigns: LinkedCampaign[];
  actions: LinkedActionItem[];
}

// LinkedDeal exposes project_name/customer_name/lead_name/stage plus a numeric
// total_contract_value. The linking library doesn't currently expose a
// per-deal currency, so we render the value with locale grouping but without
// a currency symbol — better than the previous raw concat which also relied
// on unchecked `as any` casts.
const formatDealAmount = (value: number | null | undefined): string | null => {
  if (value == null || !Number.isFinite(Number(value))) return null;
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return String(value);
  }
};

const dealTitle = (d: LinkedDeal): string =>
  d.project_name || d.customer_name || d.lead_name || "(unnamed deal)";

const SectionHeader = ({ icon: Icon, title, count }: { icon: any; title: string; count: number }) => (
  <div className="flex items-center gap-2 mt-4 mb-2">
    <Icon className="h-4 w-4 text-primary" />
    <span className="text-sm font-semibold">{title}</span>
    <Badge variant="secondary">{count}</Badge>
  </div>
);

const Empty = () => <div className="text-xs text-muted-foreground px-2">None.</div>;

export const AccountLinksDrilldown = ({ open, onOpenChange, accountName, section, contacts, deals, campaigns, actions }: Props) => {
  const showAll = !section;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Linked records</SheetTitle>
          <SheetDescription className="truncate">{accountName || "(unnamed account)"}</SheetDescription>
        </SheetHeader>

        {(showAll || section === "contacts") && (
          <>
            <SectionHeader icon={Users} title="Contacts" count={contacts.length} />
            {contacts.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.contact_name || "(unnamed)"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{[c.position, c.email].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <Link to={`/contacts?focus=${c.id}`} className="text-primary hover:underline flex items-center gap-1 text-xs">
                      Open <ExternalLink className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {(showAll || section === "deals") && (
          <>
            <SectionHeader icon={Briefcase} title="Deals" count={deals.length} />
            {deals.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {deals.map((d) => {
                  const amt = formatDealAmount(d.total_contract_value);
                  const meta = [d.stage, amt].filter(Boolean).join(" · ") || "—";
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-muted/40">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{dealTitle(d)}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{meta}</div>
                      </div>
                      <Link to={`/deals?focus=${d.id}`} className="text-primary hover:underline flex items-center gap-1 text-xs">
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {(showAll || section === "campaigns") && (
          <>
            <SectionHeader icon={Megaphone} title="Campaigns" count={campaigns.length} />
            {campaigns.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.campaign_name || "(unnamed)"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{[c.campaign_type, c.status].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <Link to={`/campaigns/${c.id}`} className="text-primary hover:underline flex items-center gap-1 text-xs">
                      Open <ExternalLink className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {(showAll || section === "actions") && (
          <>
            <SectionHeader icon={ListTodo} title="Action items" count={actions.length} />
            {actions.length === 0 ? <Empty /> : (
              <ul className="space-y-1">
                {actions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm hover:bg-muted/40">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.title || "(untitled)"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[a.status, a.due_date, a.source === "deal" ? "via deal" : null].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <Link to={`/action-items?focus=${a.id}`} className="text-primary hover:underline flex items-center gap-1 text-xs">
                      Open <ExternalLink className="h-3 w-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default AccountLinksDrilldown;
