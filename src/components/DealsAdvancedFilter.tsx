
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SlidersHorizontal, X, Bookmark, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedFilters } from "@/hooks/useSavedFilters";

export interface AdvancedFilterState {
  regions: string[];
  leadOwners: string[];
  priorities: string[];
  bus: string[];
}

interface DealsAdvancedFilterProps {
  filters: AdvancedFilterState;
  onFiltersChange: (filters: AdvancedFilterState) => void;
  availableRegions: string[];
  availableLeadOwners: string[];
  availablePriorities: string[];
  availableBUs?: string[];
  /** @deprecated kept for backwards-compat; no longer rendered */
  availableHandoffStatuses?: string[];
}

const initialFilters: AdvancedFilterState = {
  regions: [],
  leadOwners: [],
  priorities: [],
  bus: [],
};

const PRIORITY_OPTIONS = ["1", "2", "3", "4", "5"];

// Normalize legacy region codes coming from the DB to canonical UI labels.
const REGION_CODE_TO_LABEL: Record<string, string> = {
  EU: "Europe",
  EUR: "Europe",
  ASIA: "Asia",
  US: "North America",
  USA: "North America",
  NA: "North America",
  ME: "Middle East",
  SA: "South America",
  AF: "Africa",
  OC: "Oceania",
};

const normalizeRegion = (r: string) => {
  const t = (r ?? "").trim();
  if (!t) return "";
  const upper = t.toUpperCase();
  if (REGION_CODE_TO_LABEL[upper]) return REGION_CODE_TO_LABEL[upper];
  if (upper === "OTHER") return "";
  return t;
};

/** Strip removed/unknown keys so old saved filters keep working. */
const sanitizeFilters = (raw: any): AdvancedFilterState => ({
  regions: Array.isArray(raw?.regions) ? raw.regions : [],
  leadOwners: Array.isArray(raw?.leadOwners) ? raw.leadOwners : [],
  priorities: Array.isArray(raw?.priorities)
    ? raw.priorities.map((p: unknown) => String(p))
    : [],
  bus: Array.isArray(raw?.bus) ? raw.bus.map((b: unknown) => String(b)) : [],
});

interface ChipMultiSelectProps {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  renderLabel?: (value: string) => string;
}

const ChipMultiSelect = ({
  title,
  options,
  selected,
  onToggle,
  onClear,
  renderLabel,
}: ChipMultiSelectProps) => {
  if (options.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </Label>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`${title}: ${renderLabel ? renderLabel(option) : option}`}
              onClick={() => onToggle(option)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border transition-all",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-accent"
              )}
            >
              {isSelected && <Check className="w-3 h-3" />}
              {renderLabel ? renderLabel(option) : option}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const DealsAdvancedFilter = ({
  filters,
  onFiltersChange,
  availableRegions,
  availableLeadOwners,
  availablePriorities,
  availableBUs,
}: DealsAdvancedFilterProps) => {
  const [localFilters, setLocalFilters] = useState<AdvancedFilterState>(
    sanitizeFilters(filters)
  );
  const [isOpen, setIsOpen] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const { savedFilters, saveFilter, deleteFilter } = useSavedFilters("deals");

  useEffect(() => {
    setLocalFilters(sanitizeFilters(filters));
  }, [filters]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("deals-filters", JSON.stringify(filters));
    } catch {
      /* ignore quota errors */
    }
  }, [filters]);

  // Build the visible region option list from real deals data, normalized + sorted.
  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of availableRegions ?? []) {
      const norm = normalizeRegion(r);
      if (norm) set.add(norm);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableRegions]);

  const priorityOptions = useMemo(() => {
    const fromData = (availablePriorities ?? [])
      .map((p) => String(p ?? "").trim())
      .filter(Boolean);
    return fromData.length > 0
      ? Array.from(new Set(fromData)).sort()
      : PRIORITY_OPTIONS;
  }, [availablePriorities]);

  const ownerOptions = useMemo(() => {
    return Array.from(new Set((availableLeadOwners ?? []).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [availableLeadOwners]);

  const buOptions = useMemo(() => {
    const fallback = ["EBU", "RT", "MBU"];
    const fromData = (availableBUs ?? []).filter(Boolean);
    return fromData.length > 0
      ? Array.from(new Set(fromData)).sort()
      : fallback;
  }, [availableBUs]);

  const toggleValue = (
    key: keyof AdvancedFilterState,
    value: string
  ) => {
    setLocalFilters((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const clearSection = (key: keyof AdvancedFilterState) =>
    setLocalFilters((prev) => ({ ...prev, [key]: [] }));

  const applyFilters = () => {
    onFiltersChange(localFilters);
    setIsOpen(false);
  };

  const clearAllFilters = () => {
    setLocalFilters(initialFilters);
    onFiltersChange(initialFilters);
  };

  const getActiveFiltersCount = (state: AdvancedFilterState) => {
    let count = 0;
    if (state.regions.length > 0) count++;
    if (state.leadOwners.length > 0) count++;
    if (state.priorities.length > 0) count++;
    if (state.bus.length > 0) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount(filters);

  const saveCurrentFilter = async () => {
    if (!filterName.trim()) return;
    const ok = await saveFilter(filterName.trim(), localFilters);
    if (ok) {
      setFilterName("");
      setShowSaveDialog(false);
    }
  };

  const loadSavedFilter = (sf: any) => {
    const sanitized = sanitizeFilters(sf?.filters ?? {});
    setLocalFilters(sanitized);
    onFiltersChange(sanitized);
    setIsOpen(false);
  };

  const formatSavedDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-9 gap-2">
          <SlidersHorizontal className="w-4 h-4" />
          Filter
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[440px] p-0 overflow-hidden"
        align="start"
        side="bottom"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Filters</h3>
            {activeFiltersCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {activeFiltersCount}
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                aria-label="Saved filters"
              >
                <Bookmark className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 bg-popover z-50">
              <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setShowSaveDialog(true);
                }}
              >
                <Bookmark className="w-4 h-4 mr-2" />
                Save current filter…
              </DropdownMenuItem>
              {savedFilters.length > 0 && <DropdownMenuSeparator />}
              {savedFilters.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No saved filters yet.
                </div>
              ) : (
                savedFilters.map((sf) => (
                  <div
                    key={sf.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-accent rounded-sm"
                  >
                    <button
                      type="button"
                      onClick={() => loadSavedFilter(sf)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="text-sm font-medium truncate">{sf.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatSavedDate(sf.created_at)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteFilter(sf.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete saved filter ${sf.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-4 space-y-5">
          <ChipMultiSelect
            title="Regions"
            options={regionOptions}
            selected={localFilters.regions}
            onToggle={(v) => toggleValue("regions", v)}
            onClear={() => clearSection("regions")}
          />
          <ChipMultiSelect
            title="Lead Owners"
            options={ownerOptions}
            selected={localFilters.leadOwners}
            onToggle={(v) => toggleValue("leadOwners", v)}
            onClear={() => clearSection("leadOwners")}
          />
          <ChipMultiSelect
            title="Priorities"
            options={priorityOptions}
            selected={localFilters.priorities}
            onToggle={(v) => toggleValue("priorities", v)}
            onClear={() => clearSection("priorities")}
            renderLabel={(v) => `P${v}`}
          />
          <ChipMultiSelect
            title="Business Unit"
            options={buOptions}
            selected={localFilters.bus}
            onToggle={(v) => toggleValue("bus", v)}
            onClear={() => clearSection("bus")}
          />
          {regionOptions.length === 0 &&
            ownerOptions.length === 0 &&
            priorityOptions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No filter options available yet.
              </p>
            )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            disabled={
              getActiveFiltersCount(localFilters) === 0 &&
              activeFiltersCount === 0
            }
            className="gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            Clear all
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={applyFilters}>
            Apply
          </Button>
        </div>

        {/* Save dialog */}
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save filter</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="filter-name">Filter name</Label>
                <Input
                  id="filter-name"
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  placeholder="e.g. APAC priority 1 deals"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveCurrentFilter();
                  }}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowSaveDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveCurrentFilter}
                  disabled={!filterName.trim()}
                >
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </PopoverContent>
    </Popover>
  );
};
