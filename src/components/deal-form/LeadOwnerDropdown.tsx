import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLoader } from "@/components/ui/loader";

interface LeadOwnerDropdownProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const LeadOwnerDropdown = ({
  value,
  onValueChange,
  placeholder = "Select lead owner...",
  className,
}: LeadOwnerDropdownProps) => {
  const [open, setOpen] = useState(false);

  const { data: owners = [], isLoading } = useQuery({
    queryKey: ["lead-owners"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, is_deleted")
        .eq("is_deleted", false)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data || [])
        .map((p: { full_name: string | null }) => p.full_name || "")
        .filter((n) => n.trim().length > 0);
    },
  });

  const current = (value || "").trim();
  const isLegacy = current.length > 0 && !owners.some((o) => o.toLowerCase() === current.toLowerCase());

  const filteredOwners = useMemo(() => owners, [owners]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !current && "text-muted-foreground", className)}
        >
          <span className="truncate">{current || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search lead owner..." />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <AppLoader variant="inline" className="mr-2" />
                Loading...
              </div>
            ) : (
              <>
                <CommandEmpty>No matching owner found.</CommandEmpty>
                <CommandGroup heading="Users">
                  {filteredOwners.map((name) => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => {
                        onValueChange(name);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", current === name ? "opacity-100" : "opacity-0")} />
                      {name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {isLegacy && (
                  <CommandGroup heading="Legacy">
                    <CommandItem
                      key={current}
                      value={current}
                      onSelect={() => {
                        onValueChange(current);
                        setOpen(false);
                      }}
                    >
                      <Check className="mr-2 h-4 w-4 opacity-100" />
                      {current}
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
};
