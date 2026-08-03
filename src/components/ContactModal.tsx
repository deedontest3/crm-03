import { useEffect, useRef, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AccountSearchableDropdown } from "./AccountSearchableDropdown";

// Coerce a bare URL (e.g. "linkedin.com/in/foo") to a valid https:// URL so
// users don't get "Invalid URL" errors for pasting without a scheme.
const coerceUrl = (v: string | undefined) => {
  if (!v) return v;
  const s = v.trim();
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
const urlLike = z.preprocess(
  (v) => (typeof v === 'string' ? coerceUrl(v) : v),
  z.string().url("Invalid URL").optional().or(z.literal(""))
);

const contactSchema = z.object({
  contact_name: z.string().min(1, "Contact name is required"), // mandatory
  company_name: z.string().optional(),
  account_id: z.string().uuid().optional().nullable(),
  position: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")), // optional
  phone_no: z.string().optional(),
  linkedin: urlLike,
  website: urlLike,
  contact_source: z.string().optional(),
  industry: z.string().optional(),
  region: z.string().optional(),
  description: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface Contact {
  id: string;
  contact_name: string;
  company_name?: string;
  account_id?: string | null;
  position?: string;
  email?: string;
  phone_no?: string;
  linkedin?: string;
  website?: string;
  contact_source?: string;
  industry?: string;
  region?: string;
  description?: string;
}

interface ContactModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  prefillName?: string;
  prefillCompany?: string;
  onSuccess: (contact?: Contact) => void;
}

const contactSources = [
  "LinkedIn",
  "Website",
  "Referral",
  "Social Media",
  "Email Campaign",
  "Other",
];

const industries = [
  "Automotive",
  "Technology",
  "Manufacturing",
  "Other",
];

const regions = [
  "EU",
  "US",
  "ASIA",
  "Other",
];

export const ContactModal = ({ open, onOpenChange, contact, prefillName, prefillCompany, onSuccess }: ContactModalProps) => {
  const { toast } = useToast();
  const { logCreate, logUpdate } = useCRUDAudit();
  const [loading, setLoading] = useState(false);
  // Tracks the currently selected account_id independently of the display name
  // in the dropdown, so we always persist the primary key alongside the label.
  const accountIdRef = useRef<string | null>(null);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      contact_name: "",
      company_name: "",
      account_id: null,
      position: "",
      email: "",
      phone_no: "",
      linkedin: "",
      website: "",
      contact_source: "",
      industry: "Automotive",
      region: "EU",
      description: "",
    },
  });

  useEffect(() => {
    if (contact) {
      accountIdRef.current = contact.account_id ?? null;
      form.reset({
        contact_name: contact.contact_name || "",
        company_name: contact.company_name || "",
        account_id: contact.account_id ?? null,
        position: contact.position || "",
        email: contact.email || "",
        phone_no: contact.phone_no || "",
        linkedin: contact.linkedin || "",
        website: contact.website || "",
        contact_source: contact.contact_source || "",
        industry: contact.industry || "Automotive",
        region: contact.region || "EU",
        description: contact.description || "",
      });
    } else {
      accountIdRef.current = null;
      form.reset({
        contact_name: prefillName || "",
        company_name: prefillCompany || "",
        account_id: null,
        position: "",
        email: "",
        phone_no: "",
        linkedin: "",
        website: "",
        contact_source: "",
        industry: "Automotive",
        region: "EU",
        description: "",
      });
    }
  }, [contact, prefillName, prefillCompany, form]);

  const onSubmit = async (data: ContactFormData) => {
    try {
      setLoading(true);
      const user = await supabase.auth.getUser();

      if (!user.data.user) {
        toast({
          title: "Error",
          description: "You must be logged in to perform this action",
          variant: "destructive",
        });
        return;
      }

      const baseData = {
        contact_name: data.contact_name,
        company_name: data.company_name || null,
        // account_id is now first-class — the AccountSearchableDropdown records
        // the id via onAccountSelect, and clearing the name clears the id too.
        account_id: accountIdRef.current || null,
        position: data.position || null,
        email: data.email || null,
        phone_no: data.phone_no || null,
        linkedin: data.linkedin || null,
        website: data.website || null,
        contact_source: data.contact_source || null,
        industry: data.industry || null,
        region: data.region || null,
        description: data.description || null,
        modified_by: user.data.user.id,
      };

      if (contact) {
        // Update: do NOT overwrite contact_owner on edit — ownership must not
        // silently reassign to whoever last edited the record.
        const { data: updated, error } = await supabase
          .from('contacts')
          .update({
            ...baseData,
            modified_time: new Date().toISOString(),
          })
          .eq('id', contact.id)
          .select()
          .maybeSingle();

        if (error) throw error;

        await logUpdate('contacts', contact.id, baseData, contact);

        toast({ title: "Success", description: "Contact updated successfully" });
        onSuccess(updated || undefined);
      } else {
        // Create: assign ownership + creator to current user.
        const insertData = {
          ...baseData,
          created_by: user.data.user.id,
          contact_owner: user.data.user.id,
        };
        const { data: created, error } = await supabase
          .from('contacts')
          .insert(insertData)
          .select()
          .maybeSingle();

        if (error) throw error;
        if (created?.id) {
          await logCreate('contacts', created.id, insertData);
        } else {
          console.warn('[ContactModal] insert succeeded but no row returned (likely RLS SELECT restricted)');
        }

        toast({ title: "Success", description: "Contact created successfully" });
        onSuccess(created || undefined);
      }

      onOpenChange(false);
    } catch (error) {
      console.error('Error saving contact:', error);
      toast({
        title: "Error",
        description: contact ? "Failed to update contact" : "Failed to create contact",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add New Contact"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            noValidate
            onSubmit={(e) => {
              e.stopPropagation();
              form.handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contact_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Contact Name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="company_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account</FormLabel>
                    <FormControl>
                      <AccountSearchableDropdown
                        value={field.value || ""}
                        onValueChange={(val) => {
                          // val is the display name (useNameAsValue defaults true).
                          // Clearing (val === "") also clears the tracked id.
                          field.onChange(val);
                          if (!val) {
                            accountIdRef.current = null;
                            form.setValue("account_id", null);
                          }
                        }}
                        onAccountSelect={(acc) => {
                          accountIdRef.current = acc.id;
                          form.setValue("account_id", acc.id);
                          field.onChange(acc.account_name);
                        }}
                        placeholder="Select account..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Position</FormLabel>
                    <FormControl>
                      <Input placeholder="CEO" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="email@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone_no"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 234 567 8900" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="linkedin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LinkedIn Profile</FormLabel>
                    <FormControl>
                      <Input placeholder="https://linkedin.com/in/username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contact_source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Source</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>

                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {contactSources.map((source) => (
                          <SelectItem key={source} value={source}>{source}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industry</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>

                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select industry" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {industries.map((industry) => (
                          <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Region</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select region" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {regions.map((region) => (
                          <SelectItem key={region} value={region}>{region}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about the contact..."
                      className="min-h-20"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : contact ? "Save Changes" : "Add Contact"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
