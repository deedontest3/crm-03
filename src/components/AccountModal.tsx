import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { countries, regions, countryToRegion, getCurrencyForCountry } from "@/utils/countryRegionMapping";
import { useMemo } from "react";

// Permissive website validation: accept anything the URL constructor parses as
// a valid https URL once we prepend a scheme. Also accept punycode / IDN domains.
const isValidWebsite = (raw: string): boolean => {
  const v = raw.trim();
  if (!v) return true;
  try {
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withScheme);
    // Require at least one dot in the hostname, and reject bare "localhost".
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
};

// Normalize a website for storage: trim, strip trailing slash, lowercase the
// hostname portion. Leaves the scheme untouched if the user typed one; leaves
// bare domains ("example.com") as-is so the display layer can prepend https.
const normalizeWebsiteForStorage = (raw: string | undefined | null): string | null => {
  const v = (raw || "").trim();
  if (!v) return null;
  try {
    const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = u.pathname.replace(/\/+$/, "");
    const search = u.search || "";
    const hash = u.hash || "";
    if (/^https?:\/\//i.test(v)) {
      return `${u.protocol}//${host}${pathname}${search}${hash}`;
    }
    // Preserve the "bare domain" convention users typed.
    return `${host}${pathname}${search}${hash}`;
  } catch {
    return v;
  }
};

const accountSchema = z.object({
  account_name: z.string().trim().min(1, "Account name is required").max(200, "Max 200 characters"),
  phone: z.string().trim().max(40, "Max 40 characters").optional().or(z.literal("")),
  website: z
    .string()
    .trim()
    .max(255, "Max 255 characters")
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidWebsite(v), "Enter a valid website (e.g. example.com)"),
  industry: z.string().optional(),
  company_type: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  status: z.string().optional(),
  description: z.string().max(2000, "Max 2000 characters").optional(),
  currency: z.string().optional(),
});

type AccountFormData = z.infer<typeof accountSchema>;

interface Account {
  id: string;
  account_name: string;
  phone?: string;
  website?: string;
  industry?: string;
  company_type?: string;
  country?: string;
  region?: string;
  status?: string;
  description?: string;
  currency?: string;
}

interface AccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account | null;
  prefillName?: string;
  onSuccess: (account?: Account) => void;
}


const industries = ["Automotive", "Technology", "Manufacturing", "Healthcare", "Finance", "Retail", "Other"];
const companyTypes = ["OEM", "Tier-1", "Tier-2", "Other"];
const statuses = ["New", "Working", "Qualified", "Inactive"];
// Broad currency list so auto-fill from country never lands on a value the
// select can't render. Extend as new country→currency mappings are added.
const currencies = ["EUR", "USD", "INR", "GBP", "JPY", "CNY", "SEK", "CHF", "CAD", "AUD", "SGD", "KRW", "MXN", "BRL", "ZAR"];

export const AccountModal = ({ open, onOpenChange, account, prefillName, onSuccess }: AccountModalProps) => {
  const { toast } = useToast();
  const { logCreate, logUpdate } = useCRUDAudit();
  const [loading, setLoading] = useState(false);

  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      account_name: "",
      phone: "",
      website: "",
      industry: "Automotive",
      company_type: "",
      region: "Europe",
      country: "",
      status: "New",
      description: "",
      currency: "EUR",
    },
  });

  // Track whether the user manually changed currency so country-driven auto-fill
  // doesn't clobber deliberate overrides.
  const currencyManuallySetRef = useRef(false);
  // Skip the first country-change effect after reset so opening an existing
  // account doesn't overwrite its saved currency/region.
  const skipNextCountryEffectRef = useRef(false);

  useEffect(() => {
    skipNextCountryEffectRef.current = true;
    if (account) {
      // Rule: currency auto-follows country unless the user explicitly picks
      // a currency during THIS edit session. Reset the "manual" flag on open
      // so changing country still updates currency for existing accounts.
      currencyManuallySetRef.current = false;
      form.reset({
        account_name: account.account_name || "",
        phone: account.phone || "",
        website: account.website || "",
        industry: account.industry || "Automotive",
        company_type: account.company_type || "",
        region: account.region || "Europe",
        country: account.country || "",
        status: account.status || "New",
        description: account.description || "",
        currency: account.currency || "EUR",
      });
    } else {
      currencyManuallySetRef.current = false;
      form.reset({
        account_name: prefillName || "",
        phone: "",
        website: "",
        industry: "Automotive",
        company_type: "",
        region: "Europe",
        country: "",
        status: "New",
        description: "",
        currency: "EUR",
      });
    }
  }, [account, prefillName, form]);


  // Auto-update region + currency when country changes (never when opening a saved record).
  const watchedCountry = form.watch("country");
  const watchedRegion = form.watch("region");

  useEffect(() => {
    if (skipNextCountryEffectRef.current) {
      skipNextCountryEffectRef.current = false;
      return;
    }
    if (watchedCountry && countryToRegion[watchedCountry]) {
      form.setValue("region", countryToRegion[watchedCountry]);
    }
    if (!currencyManuallySetRef.current) {
      const autoCurrency = getCurrencyForCountry(watchedCountry);
      if (autoCurrency) form.setValue("currency", autoCurrency);
    }
  }, [watchedCountry, form]);

  // If the user changes the region and the current country doesn't belong to
  // that region, clear the country so the field doesn't render as blank-but-set.
  useEffect(() => {
    if (!watchedRegion || !watchedCountry) return;
    // Only clear country when the country IS mapped and the mapping conflicts
    // with the current region. If the country isn't in the mapping table (rare
    // legacy value), leave it alone so opening an existing account doesn't
    // wipe a legitimately-entered country.
    const mapped = countryToRegion[watchedCountry];
    if (mapped && mapped !== watchedRegion) {
      form.setValue("country", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedRegion]);

  // Filter countries based on selected region
  const filteredCountries = useMemo(() => {
    if (!watchedRegion) return countries;
    return countries.filter(c => countryToRegion[c] === watchedRegion);
  }, [watchedRegion]);


  const onSubmit = async (data: AccountFormData) => {
    try {
      setLoading(true);
      const user = await supabase.auth.getUser();

      if (!user.data.user) {
        toast({ title: "Error", description: "You must be logged in to perform this action", variant: "destructive" });
        return;
      }

      if (account) {
        // UPDATE: only set modified_by, preserve original account_owner
        const updateData = {
          account_name: data.account_name,
          phone: data.phone || null,
          website: normalizeWebsiteForStorage(data.website),
          industry: data.industry || null,
          company_type: data.company_type || null,
          region: data.region || null,
          country: data.country || null,
          status: data.status || 'New',
          description: data.description || null,
          currency: data.currency || 'EUR',
          modified_by: user.data.user.id,
          modified_time: new Date().toISOString(),
        };

        // maybeSingle so an RLS policy that allows UPDATE but not the SELECT
        // return-row doesn't surface as a false-positive "0 rows" failure.
        const { data: updated, error } = await supabase
          .from('accounts')
          .update(updateData)
          .eq('id', account.id)
          .select()
          .maybeSingle();
        if (error) throw error;
        await logUpdate('accounts', account.id, updateData, account);
        toast({ title: "Success", description: "Account updated successfully" });
        onSuccess((updated as Account | null) || undefined);
      } else {
        // CREATE: set account_owner, created_by, modified_by
        const insertData = {
          account_name: data.account_name,
          phone: data.phone || null,
          website: normalizeWebsiteForStorage(data.website),
          industry: data.industry || null,
          company_type: data.company_type || null,
          region: data.region || null,
          country: data.country || null,
          status: data.status || 'New',
          description: data.description || null,
          currency: data.currency || 'EUR',
          created_by: user.data.user.id,
          modified_by: user.data.user.id,
          account_owner: user.data.user.id,
        };

        const { data: newAccount, error } = await supabase
          .from('accounts')
          .insert(insertData)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (newAccount) {
          await logCreate('accounts', newAccount.id, insertData);
        }
        toast({ title: "Success", description: "Account created successfully" });
        onSuccess((newAccount as Account | null) || undefined);
      }

      onOpenChange(false);

    } catch (error: any) {
      console.error('Error saving account:', error);
      // Surface the real Postgres reason so users can act on trigger/constraint
      // errors instead of a generic "Failed to create account".
      toast({
        title: "Error",
        description: error?.message
          || (account ? "Failed to update account" : "Failed to create account"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Dirty-state guard: warn before losing unsaved edits when the dialog closes.
  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) { onOpenChange(true); return; }
    if (form.formState.isDirty && !loading) {
      const ok = window.confirm("You have unsaved changes. Discard them?");
      if (!ok) return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Edit Account" : "Add New Account"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.stopPropagation();
              form.handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
          >
            {/* Row 1: Account Name + Industry */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="account_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Name *</FormLabel>
                  <FormControl><Input autoFocus placeholder="Company Name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {industries.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 2: Description (full width) */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><AutoResizeTextarea placeholder="Additional notes about the account..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Row 3: Website + Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="website" render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl><Input placeholder="www.example.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="+1 234 567 8900" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 4: Region + Country */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="region" render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger></FormControl>
                    <SelectContent className="max-h-[300px]">
                      {filteredCountries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 5: Company Type + Currency + Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="company_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {companyTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={(v) => { currencyManuallySetRef.current = true; field.onChange(v); }} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {currencies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : account ? "Save Changes" : "Add Account"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
