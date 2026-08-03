import { useEffect, useState } from "react";
import { ContactSearchableDropdown, Contact } from "@/components/ContactSearchableDropdown";
import { supabase } from "@/integrations/supabase/client";

interface ContactIdPickerProps {
  contactId?: string;
  onChange: (contactId: string) => void;
  placeholder?: string;
}

export const ContactIdPicker = ({ contactId, onChange, placeholder }: ContactIdPickerProps) => {
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!contactId) {
      setDisplayName("");
      return;
    }
    // If value already looks like a contact name (not a uuid), leave it
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId);
    if (!isUuid) {
      setDisplayName(contactId);
      return;
    }
    supabase
      .from("contacts")
      .select("contact_name")
      .eq("id", contactId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDisplayName(data?.contact_name || "");
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return (
    <ContactSearchableDropdown
      value={displayName}
      onValueChange={(val) => {
        setDisplayName(val);
        if (val === "") onChange("");
      }}
      onContactSelect={(contact: Contact) => {
        setDisplayName(contact.contact_name);
        onChange(contact.id);
      }}
      placeholder={placeholder || "Search and select a contact..."}
    />
  );
};
