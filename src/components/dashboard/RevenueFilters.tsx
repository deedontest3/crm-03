import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";
import { fiscalLabelShort } from "@/lib/fiscalYear";

export const BU_OPTIONS = ["EBU", "RT", "MBU"] as const;
export type BU = (typeof BU_OPTIONS)[number];
export type DisplayCurrency = "EUR" | "USD" | "INR";

interface Props {
  years: number[];
  selectedYear: number;
  onYearChange: (y: number) => void;
  bus: BU[];
  onBusChange: (b: BU[]) => void;
  currency: DisplayCurrency;
  onCurrencyChange: (c: DisplayCurrency) => void;
  /** Currency codes that have a rate row available. Options without a rate are disabled. */
  availableCurrencies?: DisplayCurrency[];
}

const RevenueFilters = ({ years, selectedYear, onYearChange, bus, onBusChange, currency, onCurrencyChange, availableCurrencies }: Props) => {
  const toggleBu = (b: BU) => {
    onBusChange(bus.includes(b) ? bus.filter((x) => x !== b) : [...bus, b]);
  };
  const buLabel = bus.length === 0 ? "All BUs" : bus.length === BU_OPTIONS.length ? "All BUs" : bus.join(", ");
  const has = (c: DisplayCurrency) => !availableCurrencies || availableCurrencies.includes(c);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <Filter className="w-3.5 h-3.5 mr-1.5" />
            BU: {buLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 bg-popover">
          <DropdownMenuLabel>Business Unit</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={bus.length === 0}
            onCheckedChange={() => onBusChange([])}
          >
            All
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {BU_OPTIONS.map((b) => (
            <DropdownMenuCheckboxItem
              key={b}
              checked={bus.includes(b)}
              onCheckedChange={() => toggleBu(b)}
            >
              {b}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Select value={currency} onValueChange={(v) => onCurrencyChange(v as DisplayCurrency)}>
        <SelectTrigger className="w-24 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EUR" disabled={!has("EUR")}>€ EUR</SelectItem>
          <SelectItem value="USD" disabled={!has("USD")}>$ USD</SelectItem>
          <SelectItem value="INR" disabled={!has("INR")} title={!has("INR") ? "Add a USD↔INR rate first" : undefined}>₹ INR</SelectItem>
        </SelectContent>
      </Select>

      <Select value={selectedYear.toString()} onValueChange={(v) => onYearChange(parseInt(v))}>
        <SelectTrigger className="w-32 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={y.toString()}>
              {fiscalLabelShort(y)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default RevenueFilters;
