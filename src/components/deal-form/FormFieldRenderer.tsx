import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { DATE_DISPLAY_FORMAT, DATE_DISPLAY_PLACEHOLDER, parseDealDate, toISODate } from "@/lib/dealDate";
import { DEAL_DATE_FIELDS, getDateBounds } from "@/lib/dealDateValidation";
import { useDealFormData } from "@/components/deal-form/DealFormContext";
import { cn } from "@/lib/utils";

import { Deal, STAGE_PROBABILITY, BU_OPTIONS, type BUOption, type DealStage } from "@/types/deal";
import { ContactSearchableDropdown, Contact } from "@/components/ContactSearchableDropdown";
import { AccountSearchableDropdown } from "@/components/AccountSearchableDropdown";
import { LeadOwnerDropdown } from "@/components/deal-form/LeadOwnerDropdown";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";

interface FormFieldRendererProps {
  field: string;
  value: any;
  onChange: (field: string, value: any) => void;
  onContactSelect?: (contact: Contact) => void;
  error?: string;
  required?: boolean;
}

export const FormFieldRenderer = ({ field, value, onChange, onContactSelect, error, required }: FormFieldRendererProps) => {
  const dealFormData = useDealFormData();
  const [leadOwnerIds, setLeadOwnerIds] = useState<string[]>([]);
  const { displayNames, loading } = useUserDisplayNames(leadOwnerIds);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);


  // Auto-size textarea to match input height when empty, expand when content overflows.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (field === 'lead_owner') {
      fetchLeadOwners();
    }
  }, [field]);

  const fetchLeadOwners = async () => {
    try {
      // Fetch all unique deal owners (created_by) from deals table at Lead stage
      const { data: deals, error } = await supabase
        .from('deals')
        .select('created_by')
        .eq('stage', 'Lead')
        .not('created_by', 'is', null);

      if (error) {
        console.error('Error fetching lead owners:', error);
        return;
      }

      // Get unique user IDs
      const uniqueUserIds = Array.from(new Set((deals as any[]).map((deal: any) => deal.created_by).filter(Boolean))) as string[];
      setLeadOwnerIds(uniqueUserIds);
    } catch (error) {
      console.error('Error in fetchLeadOwners:', error);
    }
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      project_name: 'Project Name',
      customer_name: 'Account',
      lead_name: 'Contact Name',
      lead_owner: 'Lead Owner',
      region: 'Region',
      priority: 'Priority',
      probability: 'Probability (%)',
      internal_comment: 'Internal Comment',
      expected_closing_date: 'Target Closure date',
      customer_need: 'Customer Need',
      customer_challenges: 'Customer Challenges',
      current_solution: 'Current Solution',
      relationship_strength: 'Relationship Strength',
      budget: 'Budget',
      is_recurring: 'Is Recurring?',
      project_type: 'Project Type',
      duration: 'Duration (months)',
      revenue: 'Revenue',
      start_date: 'Contract Project Start Date',
      end_date: 'Project End Date',
      total_contract_value: 'Total Contract Value',
      currency_type: 'Currency Type',
      project_duration: 'Project Duration (months)',
      rfq_received_date: 'RFQ Received Date',
      proposal_due_date: 'Submission Date',
      rfq_status: 'RFQ Status',
      rfq_reference_number: 'RFQ / PO Reference Number',
      quarterly_revenue_q1: 'Q1 Revenue',
      quarterly_revenue_q2: 'Q2 Revenue',
      quarterly_revenue_q3: 'Q3 Revenue',
      quarterly_revenue_q4: 'Q4 Revenue',
      total_revenue: 'Total Revenue',
      action_items: 'Action Items',
      current_status: 'Current Status',
      closing: 'Closing',
      won_reason: 'Won Reason',
      lost_reason: 'Lost Reason',
      drop_reason: 'Drop Reason',
      fax: 'Fax',
      business_value: 'Business Value',
      decision_maker_level: 'Decision Maker Level',
      signed_contract_date: 'Signed Contract Date',
      implementation_start_date: 'Implementation Start Date',
      handoff_status: 'Handoff Status',
      bu: 'BU',
      ai: 'AI',
      strategic: 'Strategic',
      po_status: 'PO Status',
      po_number: 'PO Number',
      expected_signing_date: 'Expected PO Signing Date',
      verbal_approval_date: 'Verbal Approval Date',
      hold_reason: 'Reason for Hold',
      revise_date: 'Revise Date',
      opportunity_summary: 'Opportunity Summary',
      opportunity_description: 'Opportunity Description',
      customer_objection: 'Customer Objection',
      competition: 'Competition?',
      competitors: 'Competitors',
      final_tcv: 'Final TCV',
      next_step: 'Next Step',
      next_step_due_date: 'Next Step date',
    };
    labels.proposal_version = 'Proposal Version';
    labels.proposal_sent_date = 'Proposal Sent Date';
    labels.next_follow_up_date = 'Next Follow-up Date';

    return labels[field] || field;
  };

  const getStringValue = (val: any): string => {
    if (val === null || val === undefined) return '';
    return String(val);
  };

  const handleNumericChange = (fieldName: string, inputValue: string) => {
    
    if (inputValue === '' || inputValue === null || inputValue === undefined) {
      onChange(fieldName, 0);
      return;
    }
    
    const numericValue = parseFloat(inputValue);
    if (isNaN(numericValue)) {
      onChange(fieldName, 0);
      return;
    }
    
    // For revenue fields, ensure positive values
    if (fieldName.includes('revenue') && numericValue < 0) {
      onChange(fieldName, 0);
      return;
    }
    
    onChange(fieldName, numericValue);
  };

  const handleContactSelect = async (contact: Contact) => {
    
    // Auto-fill available fields based on contact data
    onChange('lead_name', contact.contact_name);
    if (contact.company_name) onChange('customer_name', contact.company_name);
    if (contact.region) onChange('region', contact.region);

    // Handle lead owner - fetch display name for the contact's owner
    const ownerUserId = contact.contact_owner;
    if (ownerUserId) {
      
      try {
        const { data: functionResult, error: functionError } = await supabase.functions.invoke(
          'fetch-user-display-names',
          { body: { userIds: [ownerUserId] } }
        );

        if (!functionError && functionResult?.userDisplayNames) {
          const ownerName = functionResult.userDisplayNames[ownerUserId];
          if (ownerName) {
            onChange('lead_owner', ownerName);
          } else {
            onChange('lead_owner', 'Unknown User');
          }
        } else {
          // Fallback to direct query
          const { data: profilesData } = await supabase
            .from('profiles_public' as any)
            .select('id, full_name, "Email ID"')
            .eq('id', ownerUserId)
            .single();

          if (profilesData) {
            const p = profilesData as any;
            let displayName = "Unknown User";
            if (p.full_name?.trim() &&
                !p.full_name.includes('@') &&
                p.full_name !== p["Email ID"]) {
              displayName = p.full_name.trim();
            } else if (p["Email ID"]) {
              displayName = p["Email ID"].split('@')[0];
            }
            onChange('lead_owner', displayName);
          } else {
            onChange('lead_owner', 'Unknown User');
          }
        }
      } catch (error) {
        console.error("Error fetching contact owner display name:", error);
        onChange('lead_owner', 'Unknown User');
      }
    }

    onContactSelect?.(contact);
  };

  const handleAccountSelect = (account: { region?: string; industry?: string }) => {
    // Auto-fill region from account only if currently empty
    if (account.region && !value) {
      // We can't check the form's region value from here, so we always set it
      // The parent form should handle dedup logic if needed
    }
  };

  const renderDatePicker = (fieldName: string, dateValue: any) => {
    const date = parseDealDate(dateValue) ?? undefined;
    // No days are disabled — any past or future date can be picked. Ordering
    // inconsistencies are surfaced as an inline message instead.
    const bounds =
      dealFormData && DEAL_DATE_FIELDS.has(fieldName)
        ? getDateBounds(fieldName, dealFormData as Record<string, any>)
        : {};



    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, DATE_DISPLAY_FORMAT) : <span>{DATE_DISPLAY_PLACEHOLDER}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date ?? bounds.min ?? bounds.max ?? new Date()}
            onSelect={(selectedDate) => {
              if (selectedDate) {
                onChange(fieldName, toISODate(selectedDate));
              } else {
                onChange(fieldName, '');
              }
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    );
  };



  const renderField = () => {
    switch (field) {
      case 'lead_name':
        return (
          <ContactSearchableDropdown
            value={getStringValue(value)}
            onValueChange={(val) => onChange(field, val)}
            onContactSelect={handleContactSelect}
            placeholder="Search and select a contact..."
          />
        );

      case 'customer_name':
        return (
          <AccountSearchableDropdown
            value={getStringValue(value)}
            onValueChange={(val) => onChange(field, val)}
            placeholder="Search and select an account..."
          />
        );

      case 'lead_owner':
        return (
          <LeadOwnerDropdown
            value={getStringValue(value)}
            onValueChange={(val) => onChange(field, val)}
            placeholder="Select lead owner..."
          />
        );

      case 'priority':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, parseInt(val))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map(num => (
                <SelectItem key={num} value={num.toString()}>
                  Priority {num} {num === 1 ? '(Highest)' : num === 2 ? '(High)' : num === 3 ? '(Medium)' : num === 4 ? '(Low)' : '(Lowest)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'probability': {
        const pct = typeof value === 'number' ? value : 0;
        return (
          <div className="flex items-center gap-3 h-10 px-3 rounded-md border border-input bg-muted/30">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.max(pct, 0)}%` }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums w-12 text-right">{pct}%</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">auto</span>
          </div>
        );
      }


      case 'region':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {['EU', 'US', 'ASIA', 'Other'].map(region => (
                <SelectItem key={region} value={region}>
                  {region}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'customer_need':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select customer need" />
            </SelectTrigger>
            <SelectContent>
              {['Open', 'Ongoing', 'Done'].map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'customer_challenges':
      case 'business_value':
      case 'decision_maker_level':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => {
              onChange(field, val);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${getFieldLabel(field).toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {['Open', 'Ongoing', 'Done'].map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'relationship_strength':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select relationship strength" />
            </SelectTrigger>
            <SelectContent>
              {['Low', 'Medium', 'High'].map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'budget':
        return (
          <Input
            type="number"
            step="1"
            min="0"
            value={getStringValue(value).replace(/[^0-9.\-]/g, '')}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9.\-]/g, '');
              onChange(field, cleaned);
            }}
            placeholder="0"
          />
        );

      case 'is_recurring':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => {
              onChange(field, val);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select recurring status" />
            </SelectTrigger>
            <SelectContent>
              {['Yes', 'No', 'Unclear'].map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'currency_type':
        return (
          <Select
            value={value?.toString() || 'EUR'}
            onValueChange={(val) => {
              onChange(field, val);
              // Mark currency as manually set so account selection won't overwrite it.
              onChange('__currency_manually_set' as any, true);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: 'EUR', label: '€ EUR' },
                { value: 'USD', label: '$ USD' },
                { value: 'INR', label: '₹ INR' },
              ].map(currency => (
                <SelectItem key={currency.value} value={currency.value}>
                  {currency.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'rfq_status':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select RFQ status" />
            </SelectTrigger>
            <SelectContent>
              {['Drafted', 'Submitted', 'Rejected', 'Accepted'].map(status => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'handoff_status':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => {
              onChange(field, val);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select handoff status" />
            </SelectTrigger>
            <SelectContent>
              {['Not Started', 'In Progress', 'Complete'].map(status => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'signed_contract_date':
      case 'implementation_start_date':
      case 'expected_closing_date':
      case 'start_date':
      case 'end_date':
      case 'rfq_received_date':
      case 'proposal_due_date':
      case 'expected_signing_date':
      case 'verbal_approval_date':
      case 'revise_date':
      case 'next_step_due_date':
      case 'proposal_sent_date':
      case 'next_follow_up_date':
        return renderDatePicker(field, value);


      case 'total_contract_value':
      case 'final_tcv':
        return (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={getStringValue(value)}
            onChange={(e) => {
              handleNumericChange(field, e.target.value);
            }}
            placeholder={'Enter value...'}
          />
        );

      case 'project_duration':
        return (
          <Input
            type="number"
            value={getStringValue(value)}
            readOnly
            disabled
            tabIndex={-1}
            className="bg-muted/40 cursor-not-allowed"
            placeholder="Auto-calculated from start & end date"
          />
        );

      case 'quarterly_revenue_q1':
      case 'quarterly_revenue_q2':
      case 'quarterly_revenue_q3':
      case 'quarterly_revenue_q4':
        return (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={getStringValue(value)}
            onChange={(e) => {
              handleNumericChange(field, e.target.value);
            }}
            placeholder="Enter quarterly revenue..."
          />
        );

      case 'total_revenue':
        return (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={getStringValue(value)}
            onChange={(e) => {
              handleNumericChange(field, e.target.value);
            }}
            placeholder="Enter total revenue..."
          />
        );

      case 'duration':
      case 'revenue':
        return (
          <Input
            type="number"
            value={getStringValue(value)}
            onChange={(e) => handleNumericChange(field, e.target.value)}
          />
        );

      case 'next_step':
      case 'internal_comment':
      case 'action_items':
      case 'current_solution':
      case 'won_reason':
      case 'lost_reason':
      case 'drop_reason':
      case 'opportunity_summary':
      case 'opportunity_description':
      case 'customer_objection':
      case 'competitors':
        return (
          <Textarea
            ref={textareaRef}
            value={getStringValue(value)}
            onChange={(e) => {
              onChange(field, e.target.value);
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            rows={1}
            className="h-10 min-h-10 resize-none overflow-hidden py-2 leading-tight"
            placeholder={`Enter ${getFieldLabel(field).toLowerCase()}...`}
          />
        );

      case 'fax':
        return (
          <Input
            type="tel"
            value={getStringValue(value)}
            onChange={(e) => onChange(field, e.target.value)}
            placeholder={`Enter ${getFieldLabel(field).toLowerCase()}...`}
          />
        );

      case 'bu': {
        const selected: BUOption[] = Array.isArray(value) ? value : [];
        const toggle = (opt: BUOption) => {
          const next = selected.includes(opt)
            ? selected.filter((v) => v !== opt)
            : [...selected, opt];
          onChange(field, next);
        };
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
              >
                <div className="flex flex-wrap gap-1">
                  {selected.length === 0 ? (
                    <span className="text-muted-foreground">Select BU...</span>
                  ) : (
                    selected.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))
                  )}
                </div>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
              <div className="space-y-1">
                {BU_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.includes(opt)}
                      onCheckedChange={() => toggle(opt)}
                    />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        );
      }

      case 'ai':
      case 'strategic':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${getFieldLabel(field)}`} />
            </SelectTrigger>
            <SelectContent>
              {['Yes', 'No'].map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'competition':
      case 'po_status':
      case 'current_status':
      case 'closing': {
        const optionsMap: Record<string, string[]> = {
          competition: ['Yes', 'No'],
          po_status: ['Not Required', 'Awaiting PO', 'In Process', 'Received'],
          current_status: [
            'Proposal Sent',
            'Proposal Reviewed',
            'Customer Questions',
            'Commercial Discussion',
            'Technical Clarification',
            'Waiting for Customer',
            'Internal Approval',
            'Revision Requested',
            'Final Evaluation',
          ],
          closing: ['On Track', 'Ready to Close', 'Pushed', 'Slipping', 'At Risk'],
        };
        const opts = optionsMap[field] || [];
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder={`Select ${getFieldLabel(field).toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {opts.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case 'hold_reason': {
        const opts = ['Budget Freeze', 'Project Delayed', 'Waiting Approval', 'Procurement Delay', 'Technical Review', 'Resource Constraint', 'Customer Request', 'Other'];
        return (
          <Select
            value={getStringValue(value)}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select reason for hold" />
            </SelectTrigger>
            <SelectContent>
              {opts.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }


      case 'proposal_version':
        return (
          <Select
            value={value?.toString() || ''}
            onValueChange={(val) => onChange(field, val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select proposal version" />
            </SelectTrigger>
            <SelectContent>
              {['Version 1', 'Version 2', 'Version 3', 'Version 4', 'Version 5'].map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      default:
        return (
          <Input
            value={getStringValue(value)}
            onChange={(e) => onChange(field, e.target.value)}
            placeholder={`Enter ${getFieldLabel(field).toLowerCase()}...`}
          />
        );
    }
  };

  return (
    <div
      data-field={field}
      aria-invalid={error ? true : undefined}
      className={cn(
        "space-y-1",
        error &&
          "[&_input]:border-destructive [&_textarea]:border-destructive [&_button[role=combobox]]:border-destructive [&_[data-radix-popover-trigger]]:border-destructive"
      )}
    >
      <Label className={cn(error && "text-destructive")}>
        {getFieldLabel(field)}
        {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
      </Label>
      {renderField()}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
};
