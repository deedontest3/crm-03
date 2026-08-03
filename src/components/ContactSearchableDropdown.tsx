import { useState, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showToastOnce } from "@/lib/toastOnce";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAccountLinkedContacts } from "@/lib/accountLinkedContacts";
import { AppLoader } from "@/components/ui/loader";

export interface Contact {
  id: string;
  contact_name: string;
  company_name?: string | null;
  position?: string | null;
  email?: string | null;
  phone_no?: string | null;
  region?: string | null;
  contact_owner?: string | null;
  contact_source?: string | null;
  industry?: string | null;
  linkedin?: string | null;
  website?: string | null;
  account_id?: string | null;
}

interface ContactSearchableDropdownProps {
  value?: string;
  selectedContactId?: string;
  onValueChange: (value: string) => void;
  onContactSelect?: (contact: Contact) => void;
  onRequestCreate?: (prefillName: string) => void;
  onOpenChange?: (open: boolean) => void;
  /** Preferred: filter to contacts linked to this account id (uses the same
   *  union rule as the "Contacts linked to <account>" dialog). */
  accountId?: string;
  /** Fallback name-based filter used only when accountId is not provided. */
  accountFilter?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export interface ContactSearchableDropdownHandle {
  refresh: () => Promise<void>;
}

export const ContactSearchableDropdown = forwardRef<ContactSearchableDropdownHandle, ContactSearchableDropdownProps>(({
  value,
  selectedContactId,
  onValueChange,
  onContactSelect,
  onRequestCreate,
  onOpenChange,
  accountId,
  accountFilter,
  placeholder = "Select contact...",
  className,
  disabled,
}, ref) => {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(selectedContactId);


  const fetchAllContacts = useCallback(async (accountIdFilter?: string) => {
    try {
      setLoading(true);
      // Cap server-side to 200 typeahead results — avoids downloading 4000+
      // rows on every open. The full universe is only needed when a specific
      // accountId is passed (handled by fetchAccountLinkedContacts above).
      let query = supabase
        .from("contacts" as any)
        .select("id, contact_name, company_name, position, email, phone_no, region, contact_owner, contact_source, industry, linkedin, website, account_id")
        .order("contact_name", { ascending: true })
        .limit(200);
      if (accountIdFilter) query = query.eq("account_id", accountIdFilter);
      const { data, error } = await query;
      if (error) throw error;
      setContacts(((data as any[]) || []) as Contact[]);
      return true;
    } catch (error) {
      console.error("Error fetching contacts:", error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccountLinkedContacts = useCallback(async (id: string, name: string) => {
    setLoading(true);
    try {
      const linked = await getAccountLinkedContacts([{ id, account_name: name || "" }]);
      setContacts((linked[id] || []) as Contact[]);
    } catch (error) {
      // Linked-contact lookup failed (e.g. database timeout). Fall back to a
      // cheap direct query scoped to the account instead of loading the whole
      // contacts table in the browser.
      console.error("Error fetching linked contacts, falling back to direct query:", error);
      setLoading(false);
      const ok = await fetchAllContacts(id);
      if (!ok) {
        setContacts([]);
        showToastOnce({ title: "Error", description: "Failed to fetch contacts", variant: "destructive" });
      }
      return;
    } finally {
      setLoading(false);
    }
  }, [fetchAllContacts]);


  const refresh = useCallback(async () => {
    if (accountId) {
      await fetchAccountLinkedContacts(accountId, accountFilter || "");
    } else {
      const ok = await fetchAllContacts();
      if (!ok) {
        showToastOnce({ title: "Error", description: "Failed to fetch contacts", variant: "destructive" });
      }
    }
  }, [accountId, accountFilter, fetchAccountLinkedContacts, fetchAllContacts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[-_.,()]/g, ' ').replace(/\s+/g, ' ').trim();

  const accountScoped = useMemo(() => {
    // When accountId is provided the server-side helper has already scoped
    // the list, so we don't apply an additional company_name filter here.
    if (accountId) return contacts;
    if (!accountFilter) return contacts;
    const target = normalize(accountFilter);
    const targetCompact = target.replace(/\s+/g, '');
    return contacts.filter((c) => {
      const company = normalize(c.company_name || '');
      if (!company) return false;
      if (company === target) return true;
      const companyCompact = company.replace(/\s+/g, '');
      // Fuzzy: either side is a prefix/substring of the other (min 4 chars to
      // avoid short-name false positives like "BMW" matching everything).
      if (target.length >= 4 && (company.startsWith(target + ' ') || companyCompact.startsWith(targetCompact))) return true;
      if (company.length >= 4 && (target.startsWith(company + ' ') || targetCompact.startsWith(companyCompact))) return true;
      return false;
    });
  }, [contacts, accountId, accountFilter]);

  const HARD_CAP = accountId ? Number.POSITIVE_INFINITY : 200;

  const filteredContacts = useMemo(() => {
    if (!searchValue) return accountScoped.slice(0, HARD_CAP);
    const searchWords = normalize(searchValue).split(' ').filter(Boolean);
    return accountScoped.filter((c) => {
      const combined = normalize(
        `${c.contact_name || ''} ${c.company_name || ''} ${c.position || ''} ${c.email || ''}`
      );
      return searchWords.every((word) => combined.includes(word));
    }).slice(0, HARD_CAP);
  }, [accountScoped, searchValue, HARD_CAP]);

  const handleSelect = (contact: Contact) => {
    onValueChange(contact.contact_name);
    setSelectedId(contact.id);
    onContactSelect?.(contact);
    setOpen(false);
    setSearchValue("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange("");
    setSelectedId(undefined);
  };

  const handleCreate = () => {
    setOpen(false);
    const prefill = searchValue.trim();
    setSearchValue("");
    onRequestCreate?.(prefill);
  };

  const isDisabled = disabled;

  return (
    <Popover open={open} onOpenChange={(o) => { if (isDisabled) return; setOpen(o); onOpenChange?.(o); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isDisabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">
              {isDisabled ? "Select an account first" : placeholder}
            </span>
          )}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {value && !isDisabled && (
              <button
                type="button"
                aria-label="Clear selection"
                onClick={handleClear}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClear(e as any); } }}
                className="p-0.5 rounded hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <X className="h-3 w-3 opacity-50 hover:opacity-100" />
              </button>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" side="bottom" avoidCollisions={false} style={{ pointerEvents: 'auto' }}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search contacts..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList
            onWheel={(e) => {
              e.stopPropagation();
              const target = e.currentTarget;
              target.scrollTop += e.deltaY;
            }}
          >
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <AppLoader variant="inline" />
                <span className="ml-2 text-sm text-muted-foreground">Loading contacts...</span>
              </div>
            ) : (
              <>
                {filteredContacts.length === 0 && !loading && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {accountFilter
                      ? `No contacts found under "${accountFilter}".`
                      : "No contacts found."}
                  </div>
                )}
                <CommandGroup>
                  {filteredContacts.map((contact) => (
                    <CommandItem
                      key={contact.id}
                      value={contact.contact_name}
                      onSelect={() => handleSelect(contact)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          (selectedId ? selectedId === contact.id : value === contact.contact_name)
                            ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{contact.contact_name}</div>
                        {(contact.company_name || contact.position) && (
                          <div className="text-xs text-muted-foreground truncate">
                            {[contact.company_name, contact.position].filter(Boolean).join(" • ")}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {onRequestCreate && (
                  <CommandGroup>
                    <CommandItem
                      value="__create_new_contact__"
                      onSelect={handleCreate}
                      className="cursor-pointer border-t text-primary"
                    >
                      <Plus className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {searchValue.trim()
                          ? `Create new contact "${searchValue.trim()}"`
                          : accountFilter
                            ? `Create new contact under "${accountFilter}"`
                            : "Create new contact"}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

ContactSearchableDropdown.displayName = "ContactSearchableDropdown";
