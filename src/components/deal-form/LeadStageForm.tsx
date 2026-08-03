import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { StageProbabilityBadge } from "./StageProbabilityBadge";
import { Deal } from "@/types/deal";
import { FormFieldRenderer } from "./FormFieldRenderer";
import {
  AccountSearchableDropdown,
  type AccountSearchableDropdownHandle,
} from "@/components/AccountSearchableDropdown";
import {
  ContactSearchableDropdown,
  type Contact,
  type ContactSearchableDropdownHandle,
} from "@/components/ContactSearchableDropdown";
import { AccountModal } from "@/components/AccountModal";
import { ContactModal } from "@/components/ContactModal";
import { cn } from "@/lib/utils";

interface LeadStageFormProps {
  formData: Partial<Deal>;
  onFieldChange: (field: string, value: any) => void;
  onContactSelect?: (contact: any) => void;
  fieldErrors: Record<string, string>;
  isCurrent?: boolean;
}

export const LeadStageForm = ({ formData, onFieldChange, onContactSelect, fieldErrors, isCurrent = true }: LeadStageFormProps) => {
  const accountRef = useRef<AccountSearchableDropdownHandle>(null);
  const contactRef = useRef<ContactSearchableDropdownHandle>(null);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountPrefill, setAccountPrefill] = useState("");
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactPrefill, setContactPrefill] = useState("");
  const [contactDropdownOpen, setContactDropdownOpen] = useState(false);

  const selectedAccount = (formData.customer_name as string) || "";

  // Remaining FormFieldRenderer-driven fields (in order, after Account + Contact)
  const remainingFields = ['bu', 'ai', 'strategic', 'priority', 'opportunity_summary', 'lead_owner'];

  const handleAccountSelect = (account: { id?: string; account_name: string; region?: string; industry?: string; currency?: string }) => {
    // Persist the FK so the Accounts page / link resolver can match this deal
    if (account.id) {
      onFieldChange('account_id', account.id);
    }
    // Auto-fill customer_name from the picked account so it always mirrors
    // the linked Account (prevents free-text drift / orphan deals).
    if (account.account_name) {
      onFieldChange('customer_name', account.account_name);
    }
    // Auto-fill region from the picked account
    if (account.region) {
      onFieldChange('region', account.region);
    }
    // Auto-fill currency from the picked account, unless the user already manually
    // changed it on this deal. We track manual overrides via __currency_manually_set.
    if (account.currency && !(formData as any).__currency_manually_set) {
      onFieldChange('currency_type', account.currency);
    }
    // If the previously selected contact belonged to a different account, clear it
    if (formData.lead_name) {
      onFieldChange('lead_name', '');
    }
  };

  const handleAccountChange = (val: string) => {
    if (val !== formData.customer_name) {
      onFieldChange('customer_name', val);
      // Clear the FK when the account text is cleared or doesn't match the
      // previously picked account; handleAccountSelect will repopulate it
      // when a real account is chosen.
      if (!val) {
        onFieldChange('account_id', null);
      }
      // Clear contact when account changes/clears
      if (formData.lead_name) onFieldChange('lead_name', '');
    }
  };

  const handleContactPicked = (contact: Contact) => {
    // Backfill deal.account_id from the contact when the account picker was skipped
    if (contact?.account_id && !formData.account_id) {
      onFieldChange('account_id', contact.account_id);
    }
    onContactSelect?.(contact);
  };

  const handleContactCreated = async (contact?: Contact) => {
    await contactRef.current?.refresh();
    if (contact) {
      onFieldChange('lead_name', contact.contact_name);
      handleContactPicked(contact);
    }
  };

  const handleAccountCreated = async (account?: { id?: string; account_name: string; region?: string; industry?: string; currency?: string }) => {
    await accountRef.current?.refresh();
    if (account) {
      onFieldChange('customer_name', account.account_name);
      handleAccountSelect(account);
    }
  };


  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-lg">Lead Stage</CardTitle>
          {isCurrent && <StageProbabilityBadge stage="Lead" />}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* 1. Project Name */}
          <FormFieldRenderer
            field="project_name"
            value={formData.project_name}
            onChange={onFieldChange}
            error={fieldErrors.project_name}
            required
          />

          {/* 2. Account */}
          <div className="space-y-1">
            <div className="flex items-center justify-between min-h-6">
              <Label className={cn((fieldErrors.account_id || fieldErrors.customer_name) && "text-destructive")}>
                Account
                <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
              </Label>
              {accountDropdownOpen && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-primary"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAccountDropdownOpen(false);
                    setAccountPrefill("");
                    requestAnimationFrame(() => {
                      setTimeout(() => {
                        if (typeof document !== "undefined") {
                          document.body.style.pointerEvents = "";
                        }
                        setAccountModalOpen(true);
                      }, 50);
                    });
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  New
                </Button>
              )}
            </div>

            <AccountSearchableDropdown
              ref={accountRef}
              value={selectedAccount}
              onValueChange={handleAccountChange}
              onAccountSelect={handleAccountSelect}
              onOpenChange={setAccountDropdownOpen}
              onRequestCreate={(prefill) => {
                setAccountPrefill(prefill);
                setAccountModalOpen(true);
              }}
              placeholder="Search and select an account..."
            />
            {(fieldErrors.account_id || fieldErrors.customer_name) && (
              <p className="text-xs text-destructive">
                {fieldErrors.account_id || fieldErrors.customer_name}
              </p>
            )}
          </div>

          {/* 3. Contact Name (depends on selected account) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between min-h-6">
              <Label className={cn(!selectedAccount && "text-muted-foreground", fieldErrors.lead_name && "text-destructive")}>
                Contact Name
                <span className="text-destructive ml-0.5" aria-hidden="true">*</span>
              </Label>
              {contactDropdownOpen && selectedAccount && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-primary"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContactDropdownOpen(false);
                    setContactPrefill("");
                    requestAnimationFrame(() => {
                      setTimeout(() => {
                        if (typeof document !== "undefined") {
                          document.body.style.pointerEvents = "";
                        }
                        setContactModalOpen(true);
                      }, 50);
                    });
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  New
                </Button>
              )}
            </div>

            <ContactSearchableDropdown
              ref={contactRef}
              value={(formData.lead_name as string) || ""}
              onValueChange={(val) => onFieldChange('lead_name', val)}
              onContactSelect={(contact) => handleContactPicked(contact)}
              onOpenChange={setContactDropdownOpen}
              onRequestCreate={(prefill) => {
                setContactPrefill(prefill);
                setContactModalOpen(true);
              }}
              accountFilter={selectedAccount || undefined}
              accountId={(formData.account_id as string) || undefined}
              disabled={!selectedAccount}
              placeholder="Search and select a contact..."
            />
            {fieldErrors.lead_name && (
              <p className="text-xs text-destructive">{fieldErrors.lead_name}</p>
            )}
          </div>

          {/* 4-8. BU, AI, Strategic, Opportunity Summary, Lead Owner */}
          {remainingFields.map((field) => (
            <FormFieldRenderer
              key={field}
              field={field}
              value={formData[field as keyof Deal]}
              onChange={onFieldChange}
              onContactSelect={onContactSelect}
              error={fieldErrors[field]}
              required={field === 'bu'}
            />
          ))}
        </div>
      </CardContent>

      <AccountModal
        open={accountModalOpen}
        onOpenChange={setAccountModalOpen}
        prefillName={accountPrefill}
        onSuccess={handleAccountCreated}
      />

      <ContactModal
        open={contactModalOpen}
        onOpenChange={setContactModalOpen}
        prefillName={contactPrefill}
        prefillCompany={selectedAccount}
        onSuccess={handleContactCreated}
      />
    </Card>
  );
};
