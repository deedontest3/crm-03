import { useState, useEffect, forwardRef, useImperativeHandle, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLoader } from "@/components/ui/loader";

interface Account {
  id: string;
  account_name: string;
  region?: string;
  industry?: string;
  currency?: string;
}

interface AccountSearchableDropdownProps {
  value?: string;
  /** Called with the account id (or empty string on clear). Prefer this. */
  onValueChange: (value: string) => void;
  onAccountSelect?: (account: Account) => void;
  onRequestCreate?: (prefillName: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  className?: string;
  /**
   * Legacy behavior — set to true to make onValueChange receive the account
   * NAME instead of the id (kept for callers that persist names, not ids).
   */
  useNameAsValue?: boolean;
}

export interface AccountSearchableDropdownHandle {
  refresh: () => Promise<void>;
}

export const AccountSearchableDropdown = forwardRef<AccountSearchableDropdownHandle, AccountSearchableDropdownProps>(({
  value,
  onValueChange,
  onAccountSelect,
  onRequestCreate,
  onOpenChange,
  placeholder = "Select account...",
  className,
  useNameAsValue = true,
}, ref) => {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();

  // Server-side search via SECURITY DEFINER RPC — avoids the 1000-row cap that
  // silently hid accounts beyond the first page on large workspaces. Falls back
  // to a client scan if the RPC isn't installed.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fetchAccounts = useCallback(async (query: string = "") => {
    try {
      setLoading(true);
      const { data, error } = await (supabase as any).rpc("search_accounts", {
        p_query: query,
        p_limit: 50,
      });
      if (!error && Array.isArray(data)) {
        setAccounts(data as Account[]);
        return;
      }
      // Fallback: paginated client scan — walks past the previous 1000-row cap
      // so large workspaces without the RPC still see every account.
      const pageSize = 1000;
      let from = 0;
      const collected: Account[] = [];
      // Cap total to 5k to avoid runaway fetches; anything past that really
      // needs the RPC installed.
      const HARD_CAP = 5000;
      while (collected.length < HARD_CAP) {
        const { data: rows, error: err } = await supabase
          .from("accounts" as any)
          .select("id, account_name, region, industry, currency")
          .order("account_name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (err) throw err;
        const list = (rows as any[]) || [];
        collected.push(...list);
        if (list.length < pageSize) break;
        from += pageSize;
      }
      setAccounts(collected);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      toast({ title: "Error", description: "Failed to fetch accounts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAccounts(""); }, [fetchAccounts]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { fetchAccounts(searchValue); }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchValue, open, fetchAccounts]);

  useImperativeHandle(ref, () => ({ refresh: () => fetchAccounts(searchValue) }), [fetchAccounts, searchValue]);

  const filteredAccounts = accounts;

  const handleSelect = (account: Account) => {
    // Pass id by default so callers can key on the primary key; opt into name
    // via `useNameAsValue` for legacy callers persisting the name string.
    onValueChange(useNameAsValue ? account.account_name : account.id);
    onAccountSelect?.(account);
    setOpen(false);
    setSearchValue("");
  };

  const handleClear = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onValueChange("");
  };

  const handleCreate = () => {
    setOpen(false);
    const prefill = searchValue.trim();
    setSearchValue("");
    onRequestCreate?.(prefill);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); onOpenChange?.(o); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
        >
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {value && (
              <button
                type="button"
                aria-label="Clear selection"
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClear(e); }
                }}
                className="rounded p-0.5 opacity-50 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" side="bottom" avoidCollisions={false} style={{ pointerEvents: 'auto' }}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search accounts..."
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
                <span className="ml-2 text-sm text-muted-foreground">Loading accounts...</span>
              </div>
            ) : (
              <>
                {filteredAccounts.length === 0 && !loading && (
                  <div className="py-6 text-center text-sm text-muted-foreground">No accounts found.</div>
                )}
                <CommandGroup>
                  {filteredAccounts.map((account) => (
                    <CommandItem
                      key={account.id}
                      value={account.account_name}
                      onSelect={() => handleSelect(account)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          value === account.account_name ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{account.account_name}</div>
                        {(account.region || account.industry) && (
                          <div className="text-xs text-muted-foreground truncate">
                            {[account.region, account.industry].filter(Boolean).join(" • ")}
                          </div>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {onRequestCreate && (
                  <CommandGroup>
                    <CommandItem
                      value="__create_new_account__"
                      onSelect={handleCreate}
                      className="cursor-pointer border-t text-primary"
                    >
                      <Plus className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {searchValue.trim()
                          ? `Create new account "${searchValue.trim()}"`
                          : "Create new account"}
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

AccountSearchableDropdown.displayName = "AccountSearchableDropdown";
